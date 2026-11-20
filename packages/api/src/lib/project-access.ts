import type { ProjectRole } from "@notifier/contract/project";
import type { Database } from "@notifier/db";
import { project, projectMember } from "@notifier/db/schema/notifier";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";

import { appError } from "./errors";

export type Membership = {
  projectId: string;
  userId: string;
  role: ProjectRole;
};

/**
 * Loads the caller's membership in a project. Throws `NOT_FOUND` when there is none, so
 * non-members cannot tell a missing project from one they cannot see.
 */
export async function requireMember(
  db: Database,
  projectId: string,
  userId: string,
): Promise<Membership> {
  const [row] = await db
    .select({
      projectId: projectMember.projectId,
      userId: projectMember.userId,
      role: projectMember.role,
    })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)))
    .limit(1);
  if (!row) {
    throw appError("NOT_FOUND", "Project not found");
  }
  return row;
}

/** Like `requireMember`, and throws `FORBIDDEN` unless the caller is an owner. */
export async function requireOwner(
  db: Database,
  projectId: string,
  userId: string,
): Promise<Membership> {
  const membership = await requireMember(db, projectId, userId);
  if (membership.role !== "owner") {
    throw appError("FORBIDDEN", "Only a project owner can do this");
  }
  return membership;
}

export const PERSONAL_PROJECT_MESSAGE =
  "General is your private project: it cannot have other members or be deleted";

/**
 * Throws `FORBIDDEN` when `projectId` is a personal General project, which stays private to
 * its owner: no members, no invite grants, no deletion.
 */
export async function requireNotPersonal(db: Database, projectId: string): Promise<void> {
  const [row] = await db
    .select({ personalUserId: project.personalUserId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (row?.personalUserId) {
    throw appError("FORBIDDEN", PERSONAL_PROJECT_MESSAGE);
  }
}

/**
 * Like `requireMember`, but reports a missing membership as `NOT_FOUND` with `message`,
 * for resources inside a project (a message must look missing to non-members).
 */
export async function requireMemberOf(
  db: Database,
  projectId: string,
  userId: string,
  message: string,
): Promise<Membership> {
  try {
    return await requireMember(db, projectId, userId);
  } catch (error) {
    if (error instanceof ORPCError && error.code === "NOT_FOUND") {
      throw appError("NOT_FOUND", message);
    }
    throw error;
  }
}
