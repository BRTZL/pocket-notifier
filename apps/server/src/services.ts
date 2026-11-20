import { createAuth as createConfiguredAuth } from "@notifier/auth";
import { type Database, createDb } from "@notifier/db";

import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb(ENV);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(ENV, database ?? (await getDb()));
}
