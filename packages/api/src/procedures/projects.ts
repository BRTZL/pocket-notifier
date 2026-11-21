import { newId } from "@notifier/db/ids";
import { project, projectMember, subscription } from "@notifier/db/schema/notifier";
import { and, eq } from "drizzle-orm";

import { authed } from "../base";
import { isUniqueViolation } from "../lib/errors";
import { setProjectIcon } from "../lib/icons";
import { loadMyProject, loadMyProjects } from "../lib/my-projects";
import { requireMember, requireNotPersonal, requireOwner } from "../lib/project-access";
import { deleteProject, ensureGeneralProject, updateProject } from "../lib/projects";

const list = authed.projects.list.handler(async ({ context }) => {
  // The personal General project shows up like any other project, created on first need.
  await ensureGeneralProject(context.db, context.session.user.id);
  return loadMyProjects(context.db, context.session.user.id);
});

const get = authed.projects.get.handler(({ context, input }) =>
  loadMyProject(context.db, context.session.user.id, input.id),
);

const create = authed.projects.create.handler(async ({ context, input, errors }) => {
  const { db } = context;
  const userId = context.session.user.id;
  const taken = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.name, input.name))
    .limit(1);
  if (taken.length > 0) {
    throw errors.CONFLICT({ message: "A project with this name already exists" });
  }

  const projectId = newId("project");
  try {
    await db.batch([
      db.insert(project).values({
        id: projectId,
        name: input.name,
        displayName: input.displayName ?? null,
        description: input.description ?? null,
        iconUrl: input.iconUrl ?? null,
        defaultPriority: input.defaultPriority,
        retentionDays: input.retentionDays,
      }),
      db.insert(projectMember).values({ projectId, userId, role: "owner" }),
      db.insert(subscription).values({ projectId, userId, muted: false }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.CONFLICT({ message: "A project with this name already exists" });
    }
    throw error;
  }
  return loadMyProject(db, userId, projectId);
});

const update = authed.projects.update.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  await requireOwner(db, input.id, userId);

  const { id, ...changes } = input;
  await updateProject(db, context.files, id, changes);
  return loadMyProject(db, userId, id);
});

const setIcon = authed.projects.setIcon.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  // Owners only; the personal General project counts, its user owns it.
  await requireOwner(db, input.id, userId);
  await setProjectIcon(db, context.files, {
    projectId: input.id,
    contentType: input.contentType,
    data: input.data,
  });
  return loadMyProject(db, userId, input.id);
});

const remove = authed.projects.delete.handler(async ({ context, input }) => {
  await requireOwner(context.db, input.id, context.session.user.id);
  await requireNotPersonal(context.db, input.id);
  // Members, subscriptions, messages and their reads and responses cascade; files go too.
  await deleteProject(context.db, context.files, input.id);
  return { ok: true as const };
});

const setSubscription = authed.projects.setSubscription.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  await requireMember(db, input.projectId, userId);

  if (input.subscribed) {
    await db
      .insert(subscription)
      .values({ projectId: input.projectId, userId, muted: input.muted })
      .onConflictDoUpdate({
        target: [subscription.projectId, subscription.userId],
        set: { muted: input.muted },
      });
  } else {
    await db
      .delete(subscription)
      .where(and(eq(subscription.projectId, input.projectId), eq(subscription.userId, userId)));
  }
  return loadMyProject(db, userId, input.projectId);
});

export const projectsRouter = authed.projects.router({
  list,
  get,
  create,
  update,
  setIcon,
  delete: remove,
  setSubscription,
});
