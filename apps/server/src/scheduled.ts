import type { FileBucket } from "@notifier/api/lib/files";
import { runRetention } from "@notifier/api/retention";
import type { Database } from "@notifier/db";
import { createLogger } from "evlog";

export type ScheduledDeps = {
  getDb: () => Database;
  /** The `FILES` bucket: retention deletes attachment files with their messages. */
  getBucket: () => FileBucket;
  /** The cleanup to run; `runRetention` outside tests. */
  cleanup?: typeof runRetention;
};

/**
 * The Worker's `scheduled` handler. The hourly Cron Trigger runs the retention cleanup
 * from `architecture/retention.mdx` and records the counts on one wide event.
 */
export function createScheduledHandler(deps: ScheduledDeps) {
  const cleanup = deps.cleanup ?? runRetention;
  return (
    controller: Pick<ScheduledController, "cron" | "scheduledTime">,
    ctx: Pick<ExecutionContext, "waitUntil">,
  ) => {
    const log = createLogger({ operation: "retention", cron: controller.cron });
    const run = async () => {
      try {
        const result = await cleanup(deps.getDb(), {
          now: new Date(controller.scheduledTime),
          bucket: deps.getBucket(),
        });
        log.set({ retention: result });
      } catch (error) {
        log.error(error instanceof Error ? error : String(error));
        // Rethrown so the Cron Trigger shows as failed; the next hourly run tries again.
        throw error;
      } finally {
        log.emit();
      }
    };
    ctx.waitUntil(run());
  };
}
