/**
 * Projects and features: the model agents use (through MCP) and the app shows.
 *
 * A project is a topic; the API and database keep the name `topic`. A feature is a named
 * workstream inside a project, shown in the app as a conversation: its messages carry
 * `conversation = { id: slug, title: name }`. Every user also has a personal "General"
 * project (`topic.personal_user_id`), created on first need, that takes notifications
 * sent without a project. It is private: only its owner is ever a member.
 *
 * Errors are `ORPCError`s from `appError`, so the app API passes them through as they
 * are and the MCP layer turns them into tool errors.
 */
import { type Feature, type FeatureStatus, slugify } from "@notifier/contract/feature";
import type { Action, PublishInput } from "@notifier/contract/message";
import { PublishInput as PublishInputSchema } from "@notifier/contract/message";
import type { MyTopic, TopicRole } from "@notifier/contract/topic";
import type { Database } from "@notifier/db";
import { newId } from "@notifier/db/ids";
import { user } from "@notifier/db/schema/auth";
import { device, feature, subscription, topic, topicMember } from "@notifier/db/schema/notifier";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { Dispatch } from "../dispatch";
import { appError, badRequest, isUniqueViolation } from "./errors";
import { announcePublished, type MessageRow, publishMessage, toMessage } from "./messages";
import { loadMyTopic, loadMyTopics } from "./my-topics";

export type TopicRow = typeof topic.$inferSelect;
export type FeatureRow = typeof feature.$inferSelect;

/** Display name of every personal project. */
export const GENERAL_DISPLAY_NAME = "General";
const GENERAL_DESCRIPTION = "Notifications sent without a project.";
/** Agents may name the personal project by this alias instead of its generated name. */
const GENERAL_ALIAS = "general";

export type FeatureCounts = { active: number; done: number; archived: number };

export type Project = MyTopic & { featureCounts: FeatureCounts };

const PUBLISH_ROLES: readonly TopicRole[] = ["owner", "publisher"];

function canPublish(role: TopicRole): boolean {
  return PUBLISH_ROLES.includes(role);
}

/** The caller's personal General project, if it exists yet. */
async function findGeneral(db: Database, userId: string): Promise<TopicRow | undefined> {
  const [row] = await db.select().from(topic).where(eq(topic.personalUserId, userId)).limit(1);
  return row;
}

/**
 * The caller's personal General project, created with them as owner and subscriber on
 * first need. Two concurrent first calls race on the `personal_user_id` unique index; the
 * loser re-reads the winner's row.
 */
export async function ensureGeneralProject(db: Database, userId: string): Promise<TopicRow> {
  const existing = await findGeneral(db, userId);
  if (existing) {
    return existing;
  }
  const topicId = newId("topic");
  try {
    await db.batch([
      db.insert(topic).values({
        id: topicId,
        // Topic names are unique per deployment; the id part keeps this one unique.
        name: `general-${topicId.slice("top_".length)}`,
        displayName: GENERAL_DISPLAY_NAME,
        description: GENERAL_DESCRIPTION,
        personalUserId: userId,
      }),
      db.insert(topicMember).values({ topicId, userId, role: "owner" }),
      db.insert(subscription).values({ topicId, userId, muted: false }),
    ]);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }
  const created = await findGeneral(db, userId);
  if (!created) {
    throw new Error("General project insert returned no row");
  }
  return created;
}

/** Feature counts by status for each of `topicIds`, in one query. */
async function countFeatures(
  db: Database,
  topicIds: string[],
): Promise<Map<string, FeatureCounts>> {
  const counts = new Map<string, FeatureCounts>();
  if (topicIds.length === 0) {
    return counts;
  }
  const rows = await db
    .select({ topicId: feature.topicId, status: feature.status, count: sql<number>`count(*)` })
    .from(feature)
    // One JSON parameter instead of one per id: D1 allows 100 bound parameters per query.
    .where(sql`${feature.topicId} in (select value from json_each(${JSON.stringify(topicIds)}))`)
    .groupBy(feature.topicId, feature.status);
  for (const row of rows) {
    const entry = counts.get(row.topicId) ?? { active: 0, done: 0, archived: 0 };
    entry[row.status] = Number(row.count);
    counts.set(row.topicId, entry);
  }
  return counts;
}

/** The caller's projects (their topics, General included), with feature counts. */
export async function listProjects(db: Database, userId: string): Promise<Project[]> {
  await ensureGeneralProject(db, userId);
  const topics = await loadMyTopics(db, userId);
  const counts = await countFeatures(
    db,
    topics.map((item) => item.id),
  );
  return topics.map((item) => ({
    ...item,
    featureCounts: counts.get(item.id) ?? { active: 0, done: 0, archived: 0 },
  }));
}

/** One topic with the caller's role in it, or `undefined` when they are not a member. */
async function findMembership(db: Database, userId: string, where: ReturnType<typeof eq>) {
  const [row] = await db
    .select({ topic, role: topicMember.role })
    .from(topic)
    .innerJoin(topicMember, and(eq(topicMember.topicId, topic.id), eq(topicMember.userId, userId)))
    .where(where)
    .limit(1);
  return row;
}

export type ProjectAccess = { topic: TopicRow; role: TopicRole };

/**
 * Resolves a project by name for the caller. Omitted (or `"general"` when the caller has
 * no project with that name) means their General project. `undefined` when the caller is
 * not a member of a project with that name: missing and invisible look the same.
 */
export async function findProject(
  db: Database,
  userId: string,
  name: string | undefined,
): Promise<ProjectAccess | undefined> {
  const wanted = name?.trim().toLowerCase();
  if (wanted) {
    const found = await findMembership(db, userId, eq(topic.name, wanted));
    if (found || wanted !== GENERAL_ALIAS) {
      return found;
    }
  }
  return { topic: await ensureGeneralProject(db, userId), role: "owner" };
}

export type CreateProjectInput = {
  name: string;
  displayName?: string;
  description?: string;
  defaultPriority?: number;
  retentionDays?: number;
};

/**
 * Creates a project owned by the caller (topics.create rules), or returns the caller's
 * existing one with that name when they own or publish to it. A name taken by a project
 * the caller cannot publish to is a `CONFLICT`.
 */
export async function createProject(
  db: Database,
  userId: string,
  input: CreateProjectInput,
): Promise<{ project: MyTopic; created: boolean }> {
  const takenMessage = `The project name '${input.name}' is taken. Pick another name.`;
  const [taken] = await db
    .select({ id: topic.id })
    .from(topic)
    .where(eq(topic.name, input.name))
    .limit(1);
  if (taken) {
    const mine = await findMembership(db, userId, eq(topic.id, taken.id));
    if (mine && canPublish(mine.role)) {
      return { project: await loadMyTopic(db, userId, taken.id), created: false };
    }
    throw appError("CONFLICT", takenMessage);
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
      throw appError("CONFLICT", takenMessage);
    }
    throw error;
  }
  return { project: await loadMyTopic(db, userId, topicId), created: true };
}

export function toFeature(row: FeatureRow): Feature {
  return {
    id: row.id,
    topicId: row.topicId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    conversationKey: `c:${row.slug}`,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
  };
}

/** A project's features, most recent activity first. */
export async function listFeatures(
  db: Database,
  topicId: string,
  status?: FeatureStatus,
): Promise<FeatureRow[]> {
  return await db
    .select()
    .from(feature)
    .where(and(eq(feature.topicId, topicId), status ? eq(feature.status, status) : undefined))
    .orderBy(
      desc(sql`coalesce(${feature.lastMessageAt}, ${feature.createdAt})`),
      asc(feature.slug),
    );
}

/**
 * A feature of `topicId` named by `ref`: its slug, else its name (any case).
 * `undefined` when none matches.
 */
export async function findFeature(
  db: Database,
  topicId: string,
  ref: string,
): Promise<FeatureRow | undefined> {
  const trimmed = ref.trim();
  const [bySlug] = await db
    .select()
    .from(feature)
    .where(and(eq(feature.topicId, topicId), eq(feature.slug, trimmed.toLowerCase())))
    .limit(1);
  if (bySlug) {
    return bySlug;
  }
  const [byName] = await db
    .select()
    .from(feature)
    .where(and(eq(feature.topicId, topicId), sql`lower(${feature.name}) = lower(${trimmed})`))
    .limit(1);
  return byName ?? (await findFeatureBySlug(db, topicId, slugify(trimmed)));
}

async function findFeatureBySlug(db: Database, topicId: string, slug: string) {
  const [row] = await db
    .select()
    .from(feature)
    .where(and(eq(feature.topicId, topicId), eq(feature.slug, slug)))
    .limit(1);
  return row;
}

/** Throws unless `access.role` may publish and create features. */
export function requirePublisher(access: ProjectAccess): void {
  if (!canPublish(access.role)) {
    throw appError("FORBIDDEN", "Only owners and publishers of this project can do this");
  }
}

/**
 * Creates a feature in `access.topic`, or returns the existing one with the same slug
 * (derived from `name` when not given) unchanged. Owners and publishers only.
 */
export async function createFeature(
  db: Database,
  args: {
    access: ProjectAccess;
    userId: string;
    name: string;
    slug?: string;
    description?: string;
  },
): Promise<{ feature: FeatureRow; created: boolean }> {
  requirePublisher(args.access);
  const topicId = args.access.topic.id;
  const name = args.name.trim();
  const slug = args.slug ?? slugify(name);
  const existing = await findFeatureBySlug(db, topicId, slug);
  if (existing) {
    return { feature: existing, created: false };
  }
  const [inserted] = await db
    .insert(feature)
    .values({
      id: newId("feature"),
      topicId,
      slug,
      name,
      description: args.description ?? null,
      createdBy: args.userId,
    })
    .onConflictDoNothing({ target: [feature.topicId, feature.slug] })
    .returning();
  if (inserted) {
    return { feature: inserted, created: true };
  }
  // A concurrent create won the slug.
  const raced = await findFeatureBySlug(db, topicId, slug);
  if (!raced) {
    throw new Error("feature insert returned no row");
  }
  return { feature: raced, created: false };
}

/** Sets a feature's status. Owners only. */
export async function updateFeatureStatus(
  db: Database,
  access: ProjectAccess,
  featureId: string,
  status: FeatureStatus,
): Promise<FeatureRow> {
  if (access.role !== "owner") {
    throw appError("FORBIDDEN", "Only a project owner can change a feature's status");
  }
  const [row] = await db
    .update(feature)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(feature.id, featureId), eq(feature.topicId, access.topic.id)))
    .returning();
  if (!row) {
    throw appError("NOT_FOUND", "Feature not found");
  }
  return row;
}

/** The project of a feature with the caller's role; `NOT_FOUND` for non-members. */
export async function findFeatureAccess(db: Database, userId: string, featureId: string) {
  const [row] = await db
    .select({ feature, topic, role: topicMember.role })
    .from(feature)
    .innerJoin(topic, eq(topic.id, feature.topicId))
    .innerJoin(topicMember, and(eq(topicMember.topicId, topic.id), eq(topicMember.userId, userId)))
    .where(eq(feature.id, featureId))
    .limit(1);
  if (!row) {
    throw appError("NOT_FOUND", "Feature not found");
  }
  return { feature: row.feature, access: { topic: row.topic, role: row.role } };
}

export function projectNotFound(name: string) {
  return appError(
    "NOT_FOUND",
    `Project '${name}' not found. Call list_projects to see your projects, or create_project to add it.`,
  );
}

/**
 * Where a notification goes, by name.
 *
 * - `project` omitted: the caller's General project.
 * - `feature` omitted: the project itself, no feature.
 * - `feature` given: matched by slug, then by name (any case), then by the slug of the
 *   given text. When nothing matches, the feature is created with the given text as its
 *   name (the auto-create rule), so agents can send to their current workstream directly.
 */
export async function resolveSendTarget(
  db: Database,
  userId: string,
  target: { project?: string; feature?: string },
): Promise<{ access: ProjectAccess; feature?: FeatureRow; featureCreated: boolean }> {
  const access = await findProject(db, userId, target.project);
  if (!access) {
    throw projectNotFound(target.project ?? "");
  }
  requirePublisher(access);
  if (!target.feature?.trim()) {
    return { access, featureCreated: false };
  }
  const found = await findFeature(db, access.topic.id, target.feature);
  if (found) {
    return { access, feature: found, featureCreated: false };
  }
  const created = await createFeature(db, { access, userId, name: target.feature });
  return { access, feature: created.feature, featureCreated: created.created };
}

/** What the agent asks the user, sent as a `reply` action the app's composer answers. */
export type Ask = {
  question?: string;
  quickReplies?: string[];
  /** Whether the user can type an answer. Default `true`. */
  allowText?: boolean;
};

export type SendNotificationInput = {
  title: string;
  body?: string;
  priority?: number;
  tags?: string[];
  url?: string;
  ask?: Ask;
  /** Extra links shown as buttons. */
  links?: { label: string; url: string }[];
  sender?: { id: string; name?: string };
};

/** Builds the message's actions: link buttons, then the reply action for `ask`. */
function buildActions(input: SendNotificationInput): PublishInput["actions"] {
  const actions: Action[] = (input.links ?? []).map((link, index) => ({
    type: "view",
    key: `link${index}`,
    label: link.label,
    url: link.url,
    clear: false,
  }));
  if (input.ask) {
    actions.push({
      type: "reply",
      key: "reply",
      label: "Reply",
      input: input.ask.allowText ?? true,
      quickReplies: input.ask.quickReplies?.length ? input.ask.quickReplies : undefined,
      clear: false,
    });
  }
  return actions;
}

/** The body with the question of `ask` appended, so it is visible in the notification. */
function buildBody(input: SendNotificationInput): string {
  const body = input.body?.trim() ?? "";
  const question = input.ask?.question?.trim();
  if (!question || body.includes(question)) {
    return body;
  }
  return body ? `${body}\n\n${question}` : question;
}

/** How many devices get a push for `topicId`: subscribed, unmuted members' devices. */
async function countPushDevices(db: Database, topicId: string): Promise<number> {
  return await db.$count(
    device,
    sql`${device.userId} in (select ${subscription.userId} from ${subscription} where ${subscription.topicId} = ${topicId} and ${subscription.muted} = 0)`,
  );
}

/**
 * Publishes a notification into `access.topic`, optionally into `featureRow`'s
 * conversation, hands it to the push fan-out and touches the feature's
 * `last_message_at`. Access (owner or publisher) is checked here.
 */
export async function sendNotification(
  db: Database,
  args: {
    access: ProjectAccess;
    userId: string;
    feature?: FeatureRow;
    input: SendNotificationInput;
    dispatch: Dispatch;
  },
): Promise<{ message: MessageRow; deliveredTo: number }> {
  requirePublisher(args.access);
  const { input } = args;
  const parsed = PublishInputSchema.safeParse({
    topic: args.access.topic.name,
    title: input.title,
    body: buildBody(input),
    priority: input.priority,
    tags: input.tags ?? [],
    clickUrl: input.url,
    actions: buildActions(input),
    conversation: args.feature ? { id: args.feature.slug, title: args.feature.name } : undefined,
    sender: input.sender,
  });
  if (!parsed.success) {
    throw badRequest(
      `Invalid notification: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}`,
    );
  }
  const row = await publishMessage(db, {
    topic: args.access.topic,
    publisher: { userId: args.userId, tokenId: null },
    input: parsed.data,
  });
  if (args.feature) {
    await db
      .update(feature)
      .set({ lastMessageAt: row.createdAt })
      .where(eq(feature.id, args.feature.id));
  }
  const [publisher] = await db.select().from(user).where(eq(user.id, args.userId)).limit(1);
  announcePublished(args.dispatch, toMessage(row, args.access.topic.name, publisher ?? null));
  return { message: row, deliveredTo: await countPushDevices(db, args.access.topic.id) };
}
