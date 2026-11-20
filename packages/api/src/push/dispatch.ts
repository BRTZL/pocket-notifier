import type { Message } from "@notifier/contract/message";
import type { Database } from "@notifier/db";
import { device, subscription, topicMember } from "@notifier/db/schema/notifier";
import { and, eq, sql } from "drizzle-orm";

import type { Dispatch } from "../dispatch";
import type { PushPriority, PushSender, SendResult } from "./fcm";
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
};

const DEFAULT_CONCURRENCY = 6;
/** How many failure reasons a fan-out log keeps. */
const LOGGED_FAILURES = 5;

type Recipient = { id: string; pushToken: string };

/**
 * Devices that get a push for a message in `topicId`: devices of users who are members
 * of the topic and subscribed to it without muting. The publisher is included: agents
 * publish with the user's own token, and the user wants the push.
 *
 * Android only: iOS is not in v1, and an iOS device token is an APNs token that FCM
 * would reject, which would get the device deleted as dead.
 */
export function messageRecipients(db: Database, topicId: string): Promise<Recipient[]> {
  return db
    .select({ id: device.id, pushToken: device.pushToken })
    .from(device)
    .innerJoin(
      topicMember,
      and(eq(topicMember.userId, device.userId), eq(topicMember.topicId, topicId)),
    )
    .innerJoin(
      subscription,
      and(
        eq(subscription.userId, device.userId),
        eq(subscription.topicId, topicId),
        eq(subscription.muted, false),
      ),
    )
    .where(eq(device.platform, "android"));
}

/** Every Android device of `userId`, for `dismiss` pushes. */
export function userDevices(db: Database, userId: string): Promise<Recipient[]> {
  return db
    .select({ id: device.id, pushToken: device.pushToken })
    .from(device)
    .where(and(eq(device.userId, userId), eq(device.platform, "android")));
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

type Delivery = { device: Recipient; result: SendResult };

async function deliver(
  options: Required<Pick<PushDispatchOptions, "db" | "concurrency">> & { sender: PushSender },
  log: PushLog,
  jobs: { device: Recipient; data: Record<string, string>; priority: PushPriority }[],
) {
  const deliveries = await mapPool<(typeof jobs)[number], Delivery>(
    jobs,
    options.concurrency,
    async (job) => ({
      device: job.device,
      result: await options.sender.send(job.device.pushToken, job.data, {
        priority: job.priority,
      }),
    }),
  );
  const dead = [
    ...new Set(deliveries.filter((d) => d.result.status === "dead").map((d) => d.device.id)),
  ];
  const failed = deliveries.filter((d) => d.result.status === "failed");
  await deleteDevices(options.db, dead);
  const counts = {
    sent: deliveries.filter((d) => d.result.status === "sent").length,
    dead: dead.length,
    failed: failed.length,
  };
  if (failed.length > 0) {
    log.warn("some pushes failed", {
      push: {
        failures: failed
          .slice(0, LOGGED_FAILURES)
          .map((d) => ({ deviceId: d.device.id, ...d.result })),
      },
    });
  }
  return counts;
}

/**
 * The `Dispatch` that sends FCM pushes: a `message` push to every recipient on publish,
 * and `dismiss` pushes to the reader's devices on read. All work runs in the
 * background; with no sender configured it logs once per request and does nothing.
 */
export function createPushDispatch(options: PushDispatchOptions): Dispatch {
  const { db, sender, log, runInBackground } = options;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
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
        taskLog.set({ push: { kind: "message", messageId: message.id, topic: message.topic } });
        const recipients = await messageRecipients(db, message.topicId);
        if (recipients.length === 0) {
          taskLog.set({ push: { recipients: 0 } });
          return;
        }
        const data = toPushData(message);
        const priority = fcmPriority(message.priority);
        const counts = await deliver(
          { db, concurrency, sender: pushSender },
          taskLog,
          recipients.map((recipient) => ({ device: recipient, data, priority })),
        );
        taskLog.set({
          push: { recipients: recipients.length, truncated: data.truncated === "1", ...counts },
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
          { db, concurrency, sender: pushSender },
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
