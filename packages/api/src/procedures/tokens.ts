import { TOKEN_PREFIX } from "@notifier/contract/token";
import { newId } from "@notifier/db/ids";
import { accessToken, project, projectMember } from "@notifier/db/schema/notifier";
import { randomBase62, sha256Hex } from "@notifier/db/secrets";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { authed } from "../base";
import { appError } from "../lib/errors";
import { toAccessToken } from "../lib/serialize";
import { DAY_MS, normalizeTokenScope, parseTokenScope } from "../lib/token-scope";

const SECRET_RANDOM_LENGTH = 40;
/** `nt_` plus four characters, e.g. `nt_a1b2`. */
const START_LENGTH = 7;

const list = authed.tokens.list.handler(async ({ context }) => {
  const rows = await context.db
    .select()
    .from(accessToken)
    .where(and(eq(accessToken.userId, context.session.user.id), isNull(accessToken.revokedAt)))
    .orderBy(desc(accessToken.createdAt), desc(accessToken.id));
  return rows.map((row) => {
    const scope = parseTokenScope(row.scopeJson);
    if (!scope) {
      throw new Error(`access_token ${row.id} has an unreadable scope`);
    }
    return toAccessToken(row, scope);
  });
});

const create = authed.tokens.create.handler(async ({ context, input }) => {
  const { db } = context;
  const userId = context.session.user.id;
  const scope = normalizeTokenScope(input.scope);

  if (scope.kind === "projects") {
    const rows = await db
      .select({ name: project.name, role: projectMember.role })
      .from(project)
      .innerJoin(
        projectMember,
        and(eq(projectMember.projectId, project.id), eq(projectMember.userId, userId)),
      )
      .where(inArray(project.name, scope.projects));
    const roles = new Map(rows.map((found) => [found.name, found.role]));
    for (const name of scope.projects) {
      const role = roles.get(name);
      if (!role) {
        throw appError("NOT_FOUND", `Project not found: ${name}`);
      }
      if (role === "subscriber") {
        throw appError("FORBIDDEN", `Only owners and publishers can create tokens for ${name}`);
      }
    }
  }

  const secret = `${TOKEN_PREFIX}${randomBase62(SECRET_RANDOM_LENGTH)}`;
  const [row] = await db
    .insert(accessToken)
    .values({
      id: newId("token"),
      userId,
      name: input.name,
      hash: await sha256Hex(secret),
      start: secret.slice(0, START_LENGTH),
      scopeJson: JSON.stringify(scope),
      expiresAt:
        input.expiresInDays === undefined
          ? null
          : new Date(Date.now() + input.expiresInDays * DAY_MS),
    })
    .returning();
  if (!row) {
    throw new Error("access_token insert returned no row");
  }
  return { token: toAccessToken(row, scope), secret };
});

const revoke = authed.tokens.revoke.handler(async ({ context, input }) => {
  const [row] = await context.db
    .update(accessToken)
    .set({ revokedAt: sql`coalesce(${accessToken.revokedAt}, ${Date.now()})` })
    .where(and(eq(accessToken.id, input.id), eq(accessToken.userId, context.session.user.id)))
    .returning({ id: accessToken.id });
  if (!row) {
    throw appError("NOT_FOUND", "Token not found");
  }
  return { ok: true as const };
});

export const tokensRouter = authed.tokens.router({ list, create, revoke });
