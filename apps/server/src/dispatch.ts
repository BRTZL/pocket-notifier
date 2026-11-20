import type { Dispatch } from "@notifier/api/dispatch";
import type { PushSetup } from "@notifier/api/push/config";
import { createPushDispatch, type PushTask } from "@notifier/api/push/dispatch";
import type { Database } from "@notifier/db";
import { createLogger, type RequestLogger } from "evlog";

export type DispatchOptions = {
  /** The request's wide-event logger. */
  log: RequestLogger;
  db: Database;
  /** `executionCtx.waitUntil`: keeps the Worker alive for work after the response. */
  waitUntil: (promise: Promise<unknown>) => void;
  push: PushSetup;
};

/**
 * Runs `task` after the response with its own standalone logger. The request's wide
 * event is usually emitted by then, so background work must not write to it; the
 * child event carries the parent's request id for correlation. Never rejects.
 */
export function backgroundRunner(
  parent: RequestLogger,
  waitUntil: (promise: Promise<unknown>) => void,
) {
  const parentRequestId = parent.getContext().requestId;
  return (label: string, task: PushTask) => {
    const log = createLogger({ operation: label, parentRequestId });
    const run = async () => {
      try {
        await task(log);
      } catch (error) {
        log.error(error instanceof Error ? error : String(error));
      } finally {
        log.emit();
      }
    };
    waitUntil(run());
  };
}

/** The request's `Dispatch`: FCM fan-out in `waitUntil`, or a debug log when push is off. */
export function createDispatch(options: DispatchOptions): Dispatch {
  return createPushDispatch({
    db: options.db,
    sender: options.push.sender,
    disabledReason: options.push.disabledReason,
    log: options.log,
    runInBackground: backgroundRunner(options.log, options.waitUntil),
  });
}
