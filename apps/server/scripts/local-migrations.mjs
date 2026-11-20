// Drizzle writes one folder per migration (<timestamp>_<name>/migration.sql), while
// `wrangler d1 migrations apply` expects flat .sql files. Copy them into the flat
// layout wrangler reads, so local D1 tracks applied migrations the same way.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const source = new URL("../../../packages/db/src/migrations/", import.meta.url);
const target = new URL("../.wrangler/migrations/", import.meta.url);

mkdirSync(target, { recursive: true });

const folders = readdirSync(source, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const folder of folders) {
  const file = join(source.pathname, folder, "migration.sql");
  if (existsSync(file)) {
    copyFileSync(file, join(target.pathname, `${folder}.sql`));
  }
}

console.info(`Prepared ${folders.length} migration(s) in .wrangler/migrations`);
