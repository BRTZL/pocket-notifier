import { authed } from "../base";
import { appError } from "../lib/errors";
import {
  createFeature,
  findFeatureAccess,
  listFeatures,
  toFeature,
  updateFeatureStatus,
} from "../lib/projects";
import { requireMember } from "../lib/topic-access";

async function projectAccess(
  db: Parameters<typeof requireMember>[0],
  topicId: string,
  userId: string,
) {
  const membership = await requireMember(db, topicId, userId);
  const found = await db.query.topic.findFirst({ where: { id: topicId } });
  if (!found) {
    throw appError("NOT_FOUND", "Topic not found");
  }
  return { topic: found, role: membership.role };
}

const list = authed.features.list.handler(async ({ context, input }) => {
  await requireMember(context.db, input.topicId, context.session.user.id);
  const rows = await listFeatures(context.db, input.topicId, input.status);
  return rows.map(toFeature);
});

const create = authed.features.create.handler(async ({ context, input }) => {
  const userId = context.session.user.id;
  const access = await projectAccess(context.db, input.topicId, userId);
  const { feature } = await createFeature(context.db, {
    access,
    userId,
    name: input.name,
    slug: input.slug,
    description: input.description,
  });
  return toFeature(feature);
});

const updateStatus = authed.features.updateStatus.handler(async ({ context, input }) => {
  const found = await findFeatureAccess(context.db, context.session.user.id, input.id);
  return toFeature(await updateFeatureStatus(context.db, found.access, input.id, input.status));
});

export const featuresRouter = authed.features.router({ list, create, updateStatus });
