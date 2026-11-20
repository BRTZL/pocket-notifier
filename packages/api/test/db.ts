import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Database } from "@notifier/db";
import { relations } from "@notifier/db/relations";
import { drizzle } from "drizzle-orm/d1";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/src/migrations");
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export type TestDb = {
  db: Database;
  dispose: () => Promise<void>;
};

function readMigrationStatements(): string[] {
  const folders = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return folders.flatMap((folder) =>
    readFileSync(join(MIGRATIONS_DIR, folder, "migration.sql"), "utf8")
      .split(STATEMENT_BREAKPOINT)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0),
  );
}

/**
 * Starts an in-memory D1 database in Miniflare with every migration in
 * `packages/db/src/migrations` applied, in folder order.
 */
export async function createTestDb(): Promise<TestDb> {
  // Miniflare 5 takes a new options shape; the v4 shape is still the shortest way to
  // describe "one Worker with one D1 binding".
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response(null, { status: 404 }); } };",
      compatibilityDate: "2026-11-01",
      d1Databases: ["DB"],
    }),
  );

  try {
    const d1 = await mf.getD1Database("DB");
    await d1.batch(readMigrationStatements().map((statement) => d1.prepare(statement)));
    // Miniflare types D1 against `@cloudflare/workers-types/experimental`; the shape is the same.
    const db: Database = drizzle(d1 as unknown as D1Database, { relations });
    return { db, dispose: () => mf.dispose() };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
