import { newId } from "@notifier/db/ids";
import { device } from "@notifier/db/schema/notifier";
import { and, desc, eq } from "drizzle-orm";

import { authed } from "../base";
import { appError } from "../lib/errors";
import { toDevice } from "../lib/serialize";

const list = authed.devices.list.handler(async ({ context }) => {
  const rows = await context.db
    .select()
    .from(device)
    .where(eq(device.userId, context.session.user.id))
    .orderBy(desc(device.lastSeenAt), desc(device.id));
  return rows.map(toDevice);
});

/**
 * Upserts by push token. A token registered to another user moves to the caller: the
 * phone changed accounts, and only the account signed in on it should get its pushes.
 */
const register = authed.devices.register.handler(async ({ context, input }) => {
  const now = new Date();
  const fields = {
    userId: context.session.user.id,
    name: input.name,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    lastSeenAt: now,
  };
  const [row] = await context.db
    .insert(device)
    .values({ id: newId("device"), pushToken: input.pushToken, createdAt: now, ...fields })
    .onConflictDoUpdate({ target: device.pushToken, set: fields })
    .returning();
  if (!row) {
    throw new Error("device upsert returned no row");
  }
  return toDevice(row);
});

function ownDevice(id: string, userId: string) {
  return and(eq(device.id, id), eq(device.userId, userId));
}

const rename = authed.devices.rename.handler(async ({ context, input }) => {
  const [row] = await context.db
    .update(device)
    .set({ name: input.name })
    .where(ownDevice(input.id, context.session.user.id))
    .returning();
  if (!row) {
    throw appError("NOT_FOUND", "Device not found");
  }
  return toDevice(row);
});

const remove = authed.devices.remove.handler(async ({ context, input }) => {
  const [row] = await context.db
    .delete(device)
    .where(ownDevice(input.id, context.session.user.id))
    .returning({ id: device.id });
  if (!row) {
    throw appError("NOT_FOUND", "Device not found");
  }
  return { ok: true as const };
});

export const devicesRouter = authed.devices.router({ list, register, rename, remove });
