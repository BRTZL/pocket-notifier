/**
 * Migrations replayed against rows written in an older schema. The only place outside
 * `packages/db/src/migrations` that still names the old `topic` tables: the seeds below
 * write them the way the database looked before `20261120213814_remove_topics`.
 */

import * as schema from "@notifier/db/schema/index";
import {
  feature,
  message,
  messageRead,
  messageResponse,
  project,
  projectMember,
  subscription,
} from "@notifier/db/schema/notifier";
import { eq, is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { createTestDb } from "./db";
import { clientFor, seedUser } from "./helpers";

const CONVERSATION_KEY_MIGRATION = "20261120185331_conversation_key";
const PROJECTS_FEATURES_MIGRATION = "20261120205545_projects_features_oauth";
const REMOVE_TOPICS_MIGRATION = "20261120213814_remove_topics";
const FEATURE_BACKFILL_MIGRATION = "20261120222058_feature_backfill";
const FEATURE_ID = /^fea_[0-9a-z]{26}$/u;

const LATER = Date.now() + 86_400_000;
const OLD_ID = "top_01jd8x5k2m9q7r4t6v8w0y3z5a";
const NEW_ID = "prj_01jd8x5k2m9q7r4t6v8w0y3z5a";

describe("conversation_key migration", () => {
  it("derives the key for an insert that leaves it out", async () => {
    const testDb = await createTestDb();
    try {
      const { db, d1 } = testDb;
      const ada = await seedUser(db, "ada");
      const owner = clientFor(db, ada);
      const { id: projectId } = await owner.projects.create({ name: "raw" });
      const insert = d1.prepare(
        `insert into message (id, project_id, body, priority, tags_json, actions_json, conversation_json, expires_at)
         values (?, ?, ?, 3, '[]', '[]', ?, ?)`,
      );
      await d1.batch([
        insert.bind("msg_01jd8x5k2m9q7r4t6v8w0y0001", projectId, "plain", null, LATER),
        insert.bind("msg_01jd8x5k2m9q7r4t6v8w0y0002", projectId, "conv", '{"id":"alpha"}', LATER),
      ]);

      const rows = await db
        .select({ id: message.id, key: message.conversationKey })
        .from(message)
        .where(eq(message.projectId, projectId))
        .orderBy(message.id);
      expect(rows.map((row) => row.key)).toEqual([`p:${projectId}`, "c:alpha"]);
      const { items } = await owner.conversations.list({});
      expect(items.map((item) => [item.key, item.lastMessage.body])).toEqual([
        ["c:alpha", "conv"],
        [`p:${projectId}`, "plain"],
      ]);
    } finally {
      await testDb.dispose();
    }
  });

  it("backfills existing messages from conversation_json, then the later key rewrite", async () => {
    const testDb = await createTestDb({ stopBefore: CONVERSATION_KEY_MIGRATION });
    try {
      const { d1 } = testDb;
      const insertMessage = d1.prepare(
        `insert into message (id, topic_id, priority, tags_json, actions_json, conversation_json, expires_at)
         values (?, ?, 3, '[]', '[]', ?, ?)`,
      );
      await d1.batch([
        d1.prepare("insert into topic (id, name) values (?, 'legacy')").bind(OLD_ID),
        insertMessage.bind(
          "msg_01jd8x5k2m9q7r4t6v8w0y0001",
          OLD_ID,
          '{"id":"alpha","title":"Alpha"}',
          LATER,
        ),
        insertMessage.bind("msg_01jd8x5k2m9q7r4t6v8w0y0002", OLD_ID, null, LATER),
      ]);

      await testDb.migrateRest();

      const rows = await testDb.db
        .select({ id: message.id, key: message.conversationKey })
        .from(message)
        .where(eq(message.projectId, NEW_ID))
        .orderBy(message.id);
      expect(rows).toEqual([
        { id: "msg_01jd8x5k2m9q7r4t6v8w0y0001", key: "c:alpha" },
        { id: "msg_01jd8x5k2m9q7r4t6v8w0y0002", key: `p:${NEW_ID}` },
      ]);
    } finally {
      await testDb.dispose();
    }
  });
});

describe("projects and features migration", () => {
  it("adds personal_user_id without a table rebuild, so messages survive", async () => {
    const testDb = await createTestDb({ stopBefore: PROJECTS_FEATURES_MIGRATION });
    try {
      const { d1 } = testDb;
      await d1.batch([
        d1.prepare("insert into topic (id, name) values (?, 'legacy')").bind(OLD_ID),
        d1
          .prepare(
            `insert into message (id, topic_id, priority, tags_json, actions_json, expires_at)
             values ('msg_01jd8x5k2m9q7r4t6v8w0y0001', ?, 3, '[]', '[]', ?)`,
          )
          .bind(OLD_ID, LATER),
      ]);
      await testDb.migrateRest();
      expect(await testDb.db.$count(message, eq(message.projectId, NEW_ID))).toBe(1);
      const [row] = await testDb.db.select().from(project).where(eq(project.id, NEW_ID));
      expect(row?.personalUserId).toBeNull();
    } finally {
      await testDb.dispose();
    }
  });
});

const A = "top_01jd8x5k2m9q7r4t6v8w0y3z5a";
const B = "top_01jd8x5k2m9q7r4t6v8w0y3z5b";
const GENERAL = "top_01jd8x5k2m9q7r4t6v8w0y3z5c";
const renamed = (id: string) => `prj_${id.slice(4)}`;

/** Every table the rename touches, plus the JSON that names topics. */
async function seedOldShape(d1: D1Database) {
  const user = d1.prepare("insert into user (id, name, email) values (?, ?, ?)");
  const topicRow = d1.prepare(
    "insert into topic (id, name, display_name, personal_user_id) values (?, ?, ?, ?)",
  );
  const member = d1.prepare("insert into topic_member (topic_id, user_id, role) values (?, ?, ?)");
  const sub = d1.prepare("insert into subscription (topic_id, user_id, muted) values (?, ?, ?)");
  const msg = d1.prepare(
    `insert into message (id, topic_id, body, priority, tags_json, actions_json, conversation_json, conversation_key, expires_at)
     values (?, ?, ?, 3, '[]', '[]', ?, ?, ?)`,
  );
  await d1.batch([
    user.bind("ada", "Ada", "ada@example.com"),
    user.bind("bob", "Bob", "bob@example.com"),
    topicRow.bind(A, "rezme", "Rezme", null),
    topicRow.bind(B, "ops", null, null),
    topicRow.bind(GENERAL, `general-${GENERAL.slice(4)}`, "General", "ada"),
    member.bind(A, "ada", "owner"),
    member.bind(A, "bob", "subscriber"),
    member.bind(B, "ada", "publisher"),
    member.bind(GENERAL, "ada", "owner"),
    sub.bind(A, "ada", 0),
    sub.bind(A, "bob", 1),
    sub.bind(GENERAL, "ada", 0),
    d1
      .prepare(
        "insert into feature (id, topic_id, slug, name, status) values ('fea_01jd8x5k2m9q7r4t6v8w0y0001', ?, 'speed', 'Speed', 'done')",
      )
      .bind(A),
    msg.bind("msg_01jd8x5k2m9q7r4t6v8w0y0001", A, "plain", null, `t:${A}`, LATER),
    msg.bind("msg_01jd8x5k2m9q7r4t6v8w0y0002", A, "conv", '{"id":"speed"}', "c:speed", LATER),
    msg.bind("msg_01jd8x5k2m9q7r4t6v8w0y0003", B, "ops", null, `t:${B}`, LATER),
    msg.bind("msg_01jd8x5k2m9q7r4t6v8w0y0004", GENERAL, "general", null, `t:${GENERAL}`, LATER),
    d1.prepare(
      "insert into message_read (message_id, user_id) values ('msg_01jd8x5k2m9q7r4t6v8w0y0001', 'bob')",
    ),
    d1.prepare(
      `insert into message_response (id, message_id, user_id, action_key, kind, text)
       values ('rsp_01jd8x5k2m9q7r4t6v8w0y0001', 'msg_01jd8x5k2m9q7r4t6v8w0y0002', 'bob', 'reply', 'text', 'ok')`,
    ),
    d1.prepare(
      `insert into access_token (id, user_id, name, hash, start, scope_json) values
       ('tok_01jd8x5k2m9q7r4t6v8w0y0001', 'ada', 'ci', '${"a".repeat(64)}', 'nt_a', '{"kind":"topics","topics":["rezme","ops"]}'),
       ('tok_01jd8x5k2m9q7r4t6v8w0y0002', 'ada', 'all', '${"b".repeat(64)}', 'nt_b', '{"kind":"all"}')`,
    ),
    d1
      .prepare(
        `insert into invite (id, created_by, code_hash, grants_json, expires_at) values
         ('inv_01jd8x5k2m9q7r4t6v8w0y0001', 'ada', 'h1', ?, ?),
         ('inv_01jd8x5k2m9q7r4t6v8w0y0002', 'ada', 'h2', '[]', ?)`,
      )
      .bind(
        JSON.stringify([
          { topicId: A, role: "publisher" },
          { topicId: B, role: "subscriber" },
        ]),
        LATER,
        LATER,
      ),
  ]);
}

const TABLES_AFTER = [
  "project",
  "project_member",
  "subscription",
  "feature",
  "message",
  "message_read",
  "message_response",
  "access_token",
  "invite",
] as const;

async function count(d1: D1Database, table: string): Promise<number> {
  // biome-ignore lint/complexity/noPlaywrightUselessAwait: D1 first() returns a Promise; it is not a Playwright locator.
  const row = await d1.prepare(`select count(*) as n from ${table}`).first<{ n: number }>();
  return row?.n ?? -1;
}

/** Tables, indexes and triggers, without SQLite's and D1's own. */
async function schemaObjects(d1: D1Database) {
  const { results } = await d1
    .prepare(
      `select type, name, tbl_name from sqlite_master
       where name not like 'sqlite_%' and name not like '_cf_%' and name not like 'd1_%'
       order by type, name`,
    )
    .all<{ type: string; name: string; tbl_name: string }>();
  return results;
}

describe("remove topics migration", () => {
  it("renames topics to projects and rewrites every id, key, grant and scope", async () => {
    const testDb = await createTestDb({ stopBefore: REMOVE_TOPICS_MIGRATION });
    try {
      const { d1, db } = testDb;
      await seedOldShape(d1);
      const before = {
        project: await count(d1, "topic"),
        project_member: await count(d1, "topic_member"),
        subscription: await count(d1, "subscription"),
        feature: await count(d1, "feature"),
        message: await count(d1, "message"),
        message_read: await count(d1, "message_read"),
        message_response: await count(d1, "message_response"),
        access_token: await count(d1, "access_token"),
        invite: await count(d1, "invite"),
      };

      await testDb.migrateRest();

      for (const table of TABLES_AFTER) {
        expect(await count(d1, table), table).toBe(before[table]);
      }
      expect(
        (await db.select({ id: project.id }).from(project).orderBy(project.id)).map((r) => r.id),
      ).toEqual([A, B, GENERAL].map(renamed));
      const general = await db
        .select()
        .from(project)
        .where(eq(project.id, renamed(GENERAL)));
      expect(general[0]).toMatchObject({
        personalUserId: "ada",
        name: `general-${GENERAL.slice(4)}`,
      });
      expect(
        await db
          .select({ projectId: projectMember.projectId, userId: projectMember.userId })
          .from(projectMember)
          .orderBy(projectMember.projectId, projectMember.userId),
      ).toEqual([
        { projectId: renamed(A), userId: "ada" },
        { projectId: renamed(A), userId: "bob" },
        { projectId: renamed(B), userId: "ada" },
        { projectId: renamed(GENERAL), userId: "ada" },
      ]);
      expect(
        await db
          .select({ muted: subscription.muted })
          .from(subscription)
          .orderBy(subscription.userId),
      ).toEqual([{ muted: false }, { muted: false }, { muted: true }]);
      expect((await db.select().from(feature))[0]).toMatchObject({
        projectId: renamed(A),
        slug: "speed",
        status: "done",
      });
      expect(
        await db
          .select({ id: message.id, projectId: message.projectId, key: message.conversationKey })
          .from(message)
          .orderBy(message.id),
      ).toEqual([
        { id: "msg_01jd8x5k2m9q7r4t6v8w0y0001", projectId: renamed(A), key: `p:${renamed(A)}` },
        { id: "msg_01jd8x5k2m9q7r4t6v8w0y0002", projectId: renamed(A), key: "c:speed" },
        { id: "msg_01jd8x5k2m9q7r4t6v8w0y0003", projectId: renamed(B), key: `p:${renamed(B)}` },
        {
          id: "msg_01jd8x5k2m9q7r4t6v8w0y0004",
          projectId: renamed(GENERAL),
          key: `p:${renamed(GENERAL)}`,
        },
      ]);
      const scopes = await d1
        .prepare("select scope_json as scope from access_token order by id")
        .all<{ scope: string }>();
      expect(scopes.results.map((row) => JSON.parse(row.scope))).toEqual([
        { kind: "projects", projects: ["rezme", "ops"] },
        { kind: "all" },
      ]);
      const grants = await d1
        .prepare("select grants_json as grants from invite order by id")
        .all<{ grants: string }>();
      expect(grants.results.map((row) => JSON.parse(row.grants))).toEqual([
        [
          { projectId: renamed(A), role: "publisher" },
          { projectId: renamed(B), role: "subscriber" },
        ],
        [],
      ]);

      // Nothing left in the old shape.
      // biome-ignore lint/complexity/noPlaywrightUselessAwait: D1 first() returns a Promise; it is not a Playwright locator.
      const leftovers = await d1
        .prepare(
          `select
             (select count(*) from message where conversation_key like 't:%' or project_id like 'top\\_%' escape '\\')
           + (select count(*) from project where id like 'top\\_%' escape '\\')
           + (select count(*) from invite where grants_json like '%topic%')
           + (select count(*) from access_token where scope_json like '%topic%')
           + (select count(*) from sqlite_master where sql like '%topic%') as n`,
        )
        .first<{ n: number }>();
      expect(leftovers?.n).toBe(0);
      const fkCheck = await d1.prepare("pragma foreign_key_check").all();
      expect(fkCheck.results).toEqual([]);

      // The trigger derives `p:<project id>` for an insert without a key.
      await d1
        .prepare(
          `insert into message (id, project_id, priority, tags_json, actions_json, expires_at)
           values ('msg_01jd8x5k2m9q7r4t6v8w0y0005', ?, 3, '[]', '[]', ?)`,
        )
        .bind(renamed(B), LATER)
        .run();
      const [inserted] = await db
        .select({ key: message.conversationKey })
        .from(message)
        .where(eq(message.id, "msg_01jd8x5k2m9q7r4t6v8w0y0005"));
      expect(inserted?.key).toBe(`p:${renamed(B)}`);

      // Foreign keys point at the renamed tables: deleting a project cascades to its
      // messages, and from them to reads and responses.
      await db.delete(project).where(eq(project.id, renamed(A)));
      expect(await db.$count(message, eq(message.projectId, renamed(A)))).toBe(0);
      expect(await db.$count(messageRead)).toBe(0);
      expect(await db.$count(messageResponse)).toBe(0);
      expect(await db.$count(feature)).toBe(0);
      expect(await db.$count(projectMember, eq(projectMember.projectId, renamed(A)))).toBe(0);
    } finally {
      await testDb.dispose();
    }
  });

  it("leaves the tables and indexes the Drizzle schema declares, and the key trigger", async () => {
    const testDb = await createTestDb();
    try {
      const expected = Object.values(schema as Record<string, unknown>)
        .filter((value): value is SQLiteTable => is(value, SQLiteTable))
        .flatMap((table) => {
          const config = getTableConfig(table);
          return [
            { type: "table", name: config.name, tbl_name: config.name },
            ...config.indexes.map((index) => ({
              type: "index",
              name: index.config.name,
              tbl_name: config.name,
            })),
          ];
        });
      expected.push({
        type: "trigger",
        name: "message_conversation_key_default",
        tbl_name: "message",
      });
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
      expect((await schemaObjects(testDb.d1)).toSorted(byName)).toEqual(expected.toSorted(byName));
    } finally {
      await testDb.dispose();
    }
  });
});

describe("feature backfill migration", () => {
  it("creates a feature for each valid-slug conversation that has none", async () => {
    const testDb = await createTestDb({ stopBefore: FEATURE_BACKFILL_MIGRATION });
    try {
      const { db, d1 } = testDb;
      const ada = await seedUser(db, "ada");
      const projectId = "prj_01jd8x5k2m9q7r4t6v8w0y3z5b";
      const insertMessage = d1.prepare(
        `insert into message (id, project_id, priority, tags_json, actions_json, conversation_json, conversation_key, created_at, expires_at)
         values (?, ?, 3, '[]', '[]', ?, ?, ?, ?)`,
      );
      // Raw rows: publishing through the API would already create the features.
      await d1.batch([
        d1.prepare("insert into project (id, name) values (?, 'legacy')").bind(projectId),
        d1
          .prepare(
            "insert into feature (id, project_id, slug, name, created_by) values ('fea_01jd8x5k2m9q7r4t6v8w0y3z5c', ?, 'taken', 'Taken', ?)",
          )
          .bind(projectId, ada.id),
        insertMessage.bind(
          "msg_01jd8x5k2m9q7r4t6v8w0y0001",
          projectId,
          '{"id":"alpha","title":"Old"}',
          "c:alpha",
          1000,
          LATER,
        ),
        insertMessage.bind(
          "msg_01jd8x5k2m9q7r4t6v8w0y0002",
          projectId,
          '{"id":"alpha","title":"Alpha"}',
          "c:alpha",
          2000,
          LATER,
        ),
        insertMessage.bind(
          "msg_01jd8x5k2m9q7r4t6v8w0y0003",
          projectId,
          '{"id":"beta"}',
          "c:beta",
          3000,
          LATER,
        ),
        insertMessage.bind(
          "msg_01jd8x5k2m9q7r4t6v8w0y0004",
          projectId,
          '{"id":"org/repo"}',
          "c:org/repo",
          4000,
          LATER,
        ),
        insertMessage.bind(
          "msg_01jd8x5k2m9q7r4t6v8w0y0005",
          projectId,
          '{"id":"taken","title":"Other"}',
          "c:taken",
          5000,
          LATER,
        ),
        insertMessage.bind(
          "msg_01jd8x5k2m9q7r4t6v8w0y0006",
          projectId,
          '{"id":"gone"}',
          "c:gone",
          6000,
          Date.now() - 1000,
        ),
        insertMessage.bind(
          "msg_01jd8x5k2m9q7r4t6v8w0y0007",
          projectId,
          null,
          `p:${projectId}`,
          7000,
          LATER,
        ),
      ]);
      await testDb.migrateRest();

      const rows = await db
        .select({
          id: feature.id,
          slug: feature.slug,
          name: feature.name,
          createdAt: feature.createdAt,
          lastMessageAt: feature.lastMessageAt,
        })
        .from(feature)
        .where(eq(feature.projectId, projectId))
        .orderBy(feature.slug);
      expect(rows.map(({ slug, name }) => ({ slug, name }))).toEqual([
        { slug: "alpha", name: "Alpha" },
        { slug: "beta", name: "beta" },
        { slug: "taken", name: "Taken" },
      ]);
      expect(rows[0]?.createdAt.getTime()).toBe(1000);
      expect(rows[0]?.lastMessageAt?.getTime()).toBe(2000);
      for (const row of rows) {
        expect(row.id).toMatch(FEATURE_ID);
      }
      // Messages keep their keys, including the one that is not a slug.
      const keys = await db
        .select({ key: message.conversationKey })
        .from(message)
        .where(eq(message.id, "msg_01jd8x5k2m9q7r4t6v8w0y0004"));
      expect(keys).toEqual([{ key: "c:org/repo" }]);
    } finally {
      await testDb.dispose();
    }
  });
});
