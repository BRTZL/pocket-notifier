import { newId } from "@notifier/db/ids";
import { subscription, topic, topicMember } from "@notifier/db/schema/notifier";
import { and, eq } from "drizzle-orm";

import { authed } from "../base";
import { isUniqueViolation } from "../lib/errors";
import { loadMyTopic, loadMyTopics } from "../lib/my-topics";
import { requireMember, requireOwner } from "../lib/topic-access";

const list = authed.topics.list.handler(({ context }) =>
  loadMyTopics(context.db, context.session.user.id),
);

const get = authed.topics.get.handler(({ context, input }) =>
  loadMyTopic(context.db, context.session.user.id, input.id),
);

const create = authed.topics.create.handler(async ({ context, input, errors }) => {
  const { db } = context;
  const userId = context.session.user.id;
  const taken = await db
    .select({ id: topic.id })
    .from(topic)
    .where(eq(topic.name, input.name))
    .limit(1);
  if (taken.length > 0) {
    throw errors.CONFLICT({ message: "A topic with this name already exists" });
  }

  const topicId = newId("topic");
  try {
    await db.batch([
      db.insert(topic).values({
        id: topicId,
        name: input.name,
        displayName: input.displayName ?? null,
        description: input.description ?? null,
        defaultPriority: input.defaultPriority,
        retentionDays: input.retentionDays,
      }),
      db.insert(topicMember).values({ topicId, userId, role: "owner" }),
      db.insert(subscription).values({ topicId, userId, muted: false }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.CONFLICT({ message: "A topic with this name already exists" });
    }
    throw error;
  }
  return loadMyTopic(db, userId, topicId);
});

const update = authed.topics.update.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  await requireOwner(db, input.id, userId);

  const { id, ...fields } = input;
  const changes = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<typeof topic.$inferInsert>;
  if (Object.keys(changes).length > 0) {
    await db.update(topic).set(changes).where(eq(topic.id, id));
  }
  return loadMyTopic(db, userId, id);
});

const remove = authed.topics.delete.handler(async ({ context, input }) => {
  await requireOwner(context.db, input.id, context.session.user.id);
  // Members, subscriptions, messages and their reads and responses cascade.
  await context.db.delete(topic).where(eq(topic.id, input.id));
  return { ok: true as const };
});

const setSubscription = authed.topics.setSubscription.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  await requireMember(db, input.topicId, userId);

  if (input.subscribed) {
    await db
      .insert(subscription)
      .values({ topicId: input.topicId, userId, muted: input.muted })
      .onConflictDoUpdate({
        target: [subscription.topicId, subscription.userId],
        set: { muted: input.muted },
      });
  } else {
    await db
      .delete(subscription)
      .where(and(eq(subscription.topicId, input.topicId), eq(subscription.userId, userId)));
  }
  return loadMyTopic(db, userId, input.topicId);
});

export const topicsRouter = authed.topics.router({
  list,
  get,
  create,
  update,
  delete: remove,
  setSubscription,
});
