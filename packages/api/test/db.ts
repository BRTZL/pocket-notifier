import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Database } from "@notifier/db";
import { relations } from "@notifier/db/relations";
import { drizzle } from "drizzle-orm/d1";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import type { FileBucket, Files } from "../src/lib/files";

const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/src/migrations");
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";
/** File URLs in tests; https like production, since project icon URLs must be https. */
export const TEST_FILES_ORIGIN = "https://notifier.test";

const filesByDb = new WeakMap<Database, Files>();

/** The R2 storage `createTestDb` started next to `db`. */
export function filesOf(db: Database): Files {
  const files = filesByDb.get(db);
  if (!files) {
    throw new Error("No test files for this database; create it with createTestDb");
  }
  return files;
}

export type TestDb = {
  db: Database;
  /** The raw D1 binding, for SQL in the old schema or `EXPLAIN QUERY PLAN`. */
  d1: D1Database;
  /** A Miniflare R2 bucket and `TEST_FILES_ORIGIN`, the `files` of every test context. */
  files: Files;
  /** Applies the migrations held back by `stopBefore`. */
  migrateRest: () => Promise<void>;
  dispose: () => Promise<void>;
};

export type TestDbOptions = {
  /**
   * Apply only the migrations before this folder name; `migrateRest` applies the others.
   * For testing a migration against rows written in the old shape.
   */
  stopBefore?: string;
};

function readMigrationStatements(folders: string[]): string[] {
  return folders.flatMap((folder) =>
    readFileSync(join(MIGRATIONS_DIR, folder, "migration.sql"), "utf8")
      .split(STATEMENT_BREAKPOINT)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0),
  );
}

/**
 * Starts an in-memory D1 database in Miniflare with every migration in
 * `packages/db/src/migrations` applied, in folder order, and an in-memory R2 bucket.
 */
export async function createTestDb(options: TestDbOptions = {}): Promise<TestDb> {
  const folders = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const { stopBefore } = options;
  if (stopBefore !== undefined && !folders.includes(stopBefore)) {
    throw new Error(`No migration named ${stopBefore}`);
  }
  const split = stopBefore === undefined ? folders.length : folders.indexOf(stopBefore);

  // Miniflare 5 takes a new options shape; the v4 shape is still the shortest way to
  // describe "one Worker with one D1 binding and one R2 bucket".
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response(null, { status: 404 }); } };",
      compatibilityDate: "2026-11-01",
      d1Databases: ["DB"],
      r2Buckets: ["FILES"],
    }),
  );

  try {
    // Miniflare types D1 against `@cloudflare/workers-types/experimental`; the shape is the same.
    const d1 = (await mf.getD1Database("DB")) as unknown as D1Database;
    const apply = async (names: string[]) => {
      const statements = readMigrationStatements(names);
      if (statements.length > 0) {
        await d1.batch(statements.map((statement) => d1.prepare(statement)));
      }
    };
    await apply(folders.slice(0, split));
    const db: Database = drizzle(d1, { relations });
    const files: Files = {
      bucket: (await mf.getR2Bucket("FILES")) as unknown as FileBucket,
      origin: TEST_FILES_ORIGIN,
    };
    filesByDb.set(db, files);
    return {
      db,
      d1,
      files,
      migrateRest: () => apply(folders.slice(split)),
      dispose: () => mf.dispose(),
    };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
