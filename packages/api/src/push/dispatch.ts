import type { Message } from "@notifier/contract/message";
import type { Database } from "@notifier/db";
import { device, project, projectMember, subscription } from "@notifier/db/schema/notifier";
import { and, desc, eq, sql } from "drizzle-orm";

import type { Dispatch } from "../dispatch";
import { createSendBudget, type PushPriority, type PushSender, type SendResult } from "./fcm";
import { toDismissData, toPushData } from "./payload";

/** The logger methods push code uses; evlog's request and standalone loggers fit. */
export type PushLog = {
  set: (fields: Record<string, unknown>) => void;
  debug: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (error: Error | string, context?: Record<string, unknown>) => void;
};

/** Background work with its own logger, which stays usable after the response is sent. */
export type PushTask = (log: PushLog) => Promise<void>;

export type PushDispatchOptions = {
  db: Database;
  /** `null` when push is not configured; dispatch then only logs. */
  sender: PushSender | null;
  /** Why `sender` is `null`, for the log. */
  disabledReason?: string;
  /** The request's logger. Only used synchronously, while the request is still open. */
  log: PushLog;
  /** Runs `task` after the response, e.g. with `executionCtx.waitUntil`. */
  runInBackground: (label: string, task: PushTask) => void;
  /** Parallel FCM requests per fan-out. */
  concurrency?: number;
  /** FCM requests per invocation, retries included. */
  maxSends?: number;
};

const DEFAULT_CONCURRENCY = 6;
/**
 * FCM requests one publish or markRead may make, retries included. Enough for a small
 * invited group; larger fan-outs move to a Cloudflare Queue later.
 */
export const MAX_SENDS_PER_INVOCATION = 40;
/** How many failures a fan-out log lists. */
const LOGGED_FAILURES = 5;

type Recipient = { id: string; userId: string; pushToken: string };

const recipientColumns = { id: device.id, userId: device.userId, pushToken: device.pushToken };

/**
 * Devices that get a push for a message in `projectId`: devices of users who are members
 * of the project and subscribed to it without muting, most recently seen first. The
 * publisher is included: agents publish with the user's own token, and the user wants
 * the push.
 *
 * Android only: iOS is not in v1, and an iOS device token is an APNs token that FCM
 * would reject, which would get the device deleted as dead.
 */
export function messageRecipients(db: Database, projectId: string): Promise<Recipient[]> {
  return db
    .select(recipientColumns)
    .from(device)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, device.userId), eq(projectMember.projectId, projectId)),
    )
    .innerJoin(
      subscription,
      and(
        eq(subscription.userId, device.userId),
        eq(subscription.projectId, projectId),
        eq(subscription.muted, false),
      ),
    )
    .where(eq(device.platform, "android"))
    .orderBy(desc(device.lastSeenAt), desc(device.id));
}

/** Every Android device of `userId`, most recently seen first, for `dismiss` pushes. */
export function userDevices(db: Database, userId: string): Promise<Recipient[]> {
  return db
    .select(recipientColumns)
    .from(device)
    .where(and(eq(device.userId, userId), eq(device.platform, "android")))
    .orderBy(desc(device.lastSeenAt), desc(device.id));
}

/**
 * Whether the device still has this token and still belongs to this user. A phone that
 * switched accounts while the push was queued must not get the previous user's push.
 */
async function stillOwned(db: Database, recipient: Recipient): Promise<boolean> {
  const [row] = await db
    .select({ id: device.id })
    .from(device)
    .where(
      and(
        eq(device.id, recipient.id),
        eq(device.userId, recipient.userId),
        eq(device.pushToken, recipient.pushToken),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Deletes devices FCM reported as dead, in one statement. */
export async function deleteDevices(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  // One JSON parameter instead of one per id: D1 allows 100 bound parameters per query.
  await db
    .delete(device)
    .where(sql`${device.id} in (select value from json_each(${JSON.stringify(ids)}))`);
}

/** Runs `fn` over `items` with at most `limit` calls in flight. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** FCM priority: 4–5 wake the phone right away, 1–3 may be batched by Android. */
export function fcmPriority(priority: number): PushPriority {
  return priority >= 4 ? "HIGH" : "NORMAL";
}

type Job = { device: Recipient; data: Record<string, string>; priority: PushPriority };
type Delivery = { device: Recipient; result: SendResult | { status: "moved" } };

function countOf(deliveries: Delivery[], status: Delivery["result"]["status"]) {
  return deliveries.filter((delivery) => delivery.result.status === status).length;
}

async function deliver(
  options: { db: Database; sender: PushSender; concurrency: number; maxSends: number },
  log: PushLog,
  jobs: Job[],
) {
  // Most recently seen devices come first, so they are the ones that fit the cap.
  const attempted = jobs.slice(0, options.maxSends);
  const budget = createSendBudget(options.maxSends);
  const deliveries = await mapPool<Job, Delivery>(attempted, options.concurrency, async (job) => {
    if (!(await stillOwned(options.db, job.device))) {
      return { device: job.device, result: { status: "moved" } };
    }
    const result = await options.sender.send(job.device.pushToken, job.data, {
      priority: job.priority,
      budget,
    });
    return { device: job.device, result };
  });
  const dead = [
    ...new Set(deliveries.filter((d) => d.result.status === "dead").map((d) => d.device.id)),
  ];
  await deleteDevices(options.db, dead);

  const truncated = jobs.length - attempted.length + countOf(deliveries, "skipped");
  if (truncated > 0) {
    log.warn("push truncated", { push: { truncated } });
  }
  const failures = deliveries.flatMap((d) =>
    d.result.status === "failed"
      ? [{ deviceId: d.device.id, reason: d.result.reason, httpStatus: d.result.httpStatus }]
      : [],
  );
  if (failures.length > 0) {
    log.warn("some pushes failed", { push: { failures: failures.slice(0, LOGGED_FAILURES) } });
  }
  return {
    sent: countOf(deliveries, "sent"),
    dead: dead.length,
    failed: failures.length,
    moved: countOf(deliveries, "moved"),
    truncated,
  };
}

/**
 * The `Dispatch` that sends FCM pushes: a `message` push to every recipient on publish,
 * and `dismiss` pushes to the reader's devices on read. All work runs in the
 * background; with no sender configured it logs once per request and does nothing.
 */
export function createPushDispatch(options: PushDispatchOptions): Dispatch {
  const { db, sender, log, runInBackground } = options;
  const deliverOptions = {
    db,
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    maxSends: options.maxSends ?? MAX_SENDS_PER_INVOCATION,
  };
  let loggedDisabled = false;

  const active = (): PushSender | null => {
    if (!(sender || loggedDisabled)) {
      loggedDisabled = true;
      log.debug("push disabled", { push: { disabled: options.disabledReason ?? "no sender" } });
    }
    return sender;
  };

  return {
    messagePublished: (message: Message) => {
      const pushSender = active();
      if (!pushSender) {
        return;
      }
      runInBackground("push.message", async (taskLog) => {
        taskLog.set({ push: { kind: "message", messageId: message.id, project: message.project } });
        const recipients = await messageRecipients(db, message.projectId);
        if (recipients.length === 0) {
          taskLog.set({ push: { recipients: 0 } });
          return;
        }
        const [owner] = await db
          .select({ iconUrl: project.iconUrl })
          .from(project)
          .where(eq(project.id, message.projectId))
          .limit(1);
        const data = toPushData(message, { projectIconUrl: owner?.iconUrl ?? null });
        const priority = fcmPriority(message.priority);
        const counts = await deliver(
          { ...deliverOptions, sender: pushSender },
          taskLog,
          recipients.map((recipient) => ({ device: recipient, data, priority })),
        );
        taskLog.set({
          push: {
            recipients: recipients.length,
            payloadTruncated: data.truncated === "1",
            ...counts,
          },
        });
      });
    },
    messagesRead: (userId: string, messageIds: string[]) => {
      if (messageIds.length === 0) {
        return;
      }
      const pushSender = active();
      if (!pushSender) {
        return;
      }
      runInBackground("push.dismiss", async (taskLog) => {
        taskLog.set({ push: { kind: "dismiss", userId, messages: messageIds.length } });
        const devices = await userDevices(db, userId);
        if (devices.length === 0) {
          taskLog.set({ push: { recipients: 0 } });
          return;
        }
        const pushes = toDismissData(messageIds);
        const counts = await deliver(
          { ...deliverOptions, sender: pushSender },
          taskLog,
          devices.flatMap((target) =>
            // Dismissals show nothing, so they never need to wake the phone.
            pushes.map((data) => ({ device: target, data, priority: "NORMAL" as const })),
          ),
        );
        taskLog.set({ push: { recipients: devices.length, pushes: pushes.length, ...counts } });
      });
    },
  };
}
