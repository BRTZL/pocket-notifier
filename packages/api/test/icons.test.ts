import { PROJECT_ICON_MAX_BYTES } from "@notifier/contract/project";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serveIcon } from "../src/lib/file-routes";
import { toPushData } from "../src/push/payload";
import { createTestDb, TEST_FILES_ORIGIN, type TestDb } from "./db";
import { clientFor, definedError, seedUser, type TestUser } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const ICON_URL =
  /^https:\/\/notifier\.test\/api\/icons\/prj_[0-9a-z]{26}\/[0-9a-f]{16}-[0-9A-Za-z]{10}\.png$/u;
const WEBP_FILE = /\.webp$/u;

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("project icons", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;
  let projectId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
    const owner = clientFor(testDb.db, ada);
    ({ id: projectId } = await owner.projects.create({
      name: "team",
      iconUrl: "https://example.com/team.png",
    }));
    await owner.members.add({ projectId, email: bob.email, role: "publisher" });
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  async function iconFile(url: string | null) {
    const parts = new URL(url ?? "").pathname.split("/");
    return await serveIcon(testDb.files, { projectId: parts[3] ?? "", file: parts[4] ?? "" });
  }

  it("is set on create, changed or cleared by owners, and refused to others", async () => {
    const owner = clientFor(testDb.db, ada);
    expect((await owner.projects.get({ id: projectId })).iconUrl).toBe(
      "https://example.com/team.png",
    );
    const changed = await owner.projects.update({
      id: projectId,
      iconUrl: "https://example.com/other.png",
    });
    expect(changed.iconUrl).toBe("https://example.com/other.png");
    // Other fields leave the icon alone.
    expect((await owner.projects.update({ id: projectId, description: "x" })).iconUrl).toBe(
      "https://example.com/other.png",
    );
    await expect(
      clientFor(testDb.db, bob).projects.update({ id: projectId, iconUrl: null }),
    ).rejects.toMatchObject(definedError("FORBIDDEN"));
    await expect(
      owner.projects.update({ id: projectId, iconUrl: "http://example.com/plain.png" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await owner.projects.update({ id: projectId, iconUrl: null })).iconUrl).toBeNull();
  });

  it("uploads with setIcon, serves the bytes and deletes the icon it replaces", async () => {
    const owner = clientFor(testDb.db, ada);
    const first = await owner.projects.setIcon({
      id: projectId,
      contentType: "image/png",
      data: base64(PNG),
    });
    expect(first.iconUrl).toMatch(ICON_URL);
    const served = await iconFile(first.iconUrl);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/png");
    expect(served.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(served.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(served.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);

    const second = await owner.projects.setIcon({
      id: projectId,
      contentType: "image/webp",
      data: base64(WEBP),
    });
    expect(second.iconUrl).toMatch(WEBP_FILE);
    expect((await iconFile(first.iconUrl)).status).toBe(404);
    expect((await iconFile(second.iconUrl)).status).toBe(200);

    // Clearing deletes the uploaded file too.
    await owner.projects.update({ id: projectId, iconUrl: null });
    expect((await iconFile(second.iconUrl)).status).toBe(404);
    expect((await testDb.files.bucket.list({ prefix: "icons/" })).objects).toHaveLength(0);
  });

  it("never deletes another project's uploaded icon", async () => {
    const owner = clientFor(testDb.db, ada);
    const other = await owner.projects.create({ name: "other" });
    const icon = await owner.projects.setIcon({
      id: other.id,
      contentType: "image/png",
      data: base64(PNG),
    });
    await owner.projects.update({ id: projectId, iconUrl: icon.iconUrl });
    await owner.projects.update({ id: projectId, iconUrl: null });
    expect((await iconFile(icon.iconUrl)).status).toBe(200);
  });

  it("rejects wrong magic bytes, oversized images and non-owners", async () => {
    const owner = clientFor(testDb.db, ada);
    await expect(
      owner.projects.setIcon({ id: projectId, contentType: "image/jpeg", data: base64(PNG) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "The data is not a image/jpeg image" });
    const tooLarge = new Uint8Array(PROJECT_ICON_MAX_BYTES + 1);
    tooLarge.set(PNG);
    await expect(
      owner.projects.setIcon({ id: projectId, contentType: "image/png", data: base64(tooLarge) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("larger") });
    await expect(
      clientFor(testDb.db, bob).projects.setIcon({
        id: projectId,
        contentType: "image/png",
        data: base64(PNG),
      }),
    ).rejects.toMatchObject(definedError("FORBIDDEN"));
    expect((await testDb.files.bucket.list({ prefix: "icons/" })).objects).toHaveLength(0);
  });

  it("lets the owner give the personal General project an icon", async () => {
    const owner = clientFor(testDb.db, ada);
    const general = (await owner.projects.list()).find((item) => item.personal);
    const updated = await owner.projects.setIcon({
      id: general?.id ?? "",
      contentType: "image/png",
      data: base64(PNG),
    });
    expect(updated.iconUrl?.startsWith(TEST_FILES_ORIGIN)).toBe(true);
  });

  it("is the conversation icon in summaries and pushes, ahead of the message's own", async () => {
    const owner = clientFor(testDb.db, ada);
    const published: Parameters<typeof toPushData>[0][] = [];
    await clientFor(testDb.db, ada, {
      messagePublished: (item) => {
        published.push(item);
      },
      messagesRead: () => undefined,
    }).messages.publish({
      project: "team",
      title: "hi",
      conversation: { id: "perf", iconUrl: "https://example.com/conversation.png" },
    });
    const { items } = await owner.conversations.list({});
    expect(items[0]?.iconUrl).toBe("https://example.com/team.png");
    const message = published[0];
    if (!message) {
      throw new Error("nothing published");
    }
    expect(toPushData(message, { projectIconUrl: "https://example.com/team.png" })).toMatchObject({
      conversationIcon: "https://example.com/team.png",
    });
    await owner.projects.update({ id: projectId, iconUrl: null });
    expect((await owner.conversations.list({})).items[0]?.iconUrl).toBe(
      "https://example.com/conversation.png",
    );
    expect(toPushData(message, { projectIconUrl: null }).conversationIcon).toBe(
      "https://example.com/conversation.png",
    );
  });

  it("keeps the current icon when uploads race, and gives the same bytes a new key", async () => {
    const owner = clientFor(testDb.db, ada);
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        owner.projects.setIcon({ id: projectId, contentType: "image/png", data: base64(PNG) }),
      ),
    );
    const urls = new Set(results.map((item) => item.iconUrl));
    expect(urls.size).toBe(3);
    const current = (await owner.projects.get({ id: projectId })).iconUrl;
    expect((await iconFile(current)).status).toBe(200);
    // Every replaced upload is gone; only the current one is left.
    expect((await testDb.files.bucket.list({ prefix: "icons/" })).objects).toHaveLength(1);
  });

  it("cleans icons even when deleting attachment files fails", async () => {
    const owner = clientFor(testDb.db, ada);
    await owner.projects.setIcon({ id: projectId, contentType: "image/png", data: base64(PNG) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { bucket } = testDb.files;
    const flaky = {
      ...bucket,
      get: bucket.get.bind(bucket),
      put: bucket.put.bind(bucket),
      delete: bucket.delete.bind(bucket),
      createMultipartUpload: bucket.createMultipartUpload.bind(bucket),
      list: (options?: R2ListOptions) =>
        options?.prefix?.startsWith("attachments/")
          ? Promise.reject(new Error("r2 down"))
          : bucket.list(options),
    };
    await clientFor(testDb.db, ada, undefined, { ...testDb.files, bucket: flaky }).projects.delete({
      id: projectId,
    });
    expect((await bucket.list({ prefix: "icons/" })).objects).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith(
      "deleting a deleted project's files failed",
      expect.objectContaining({ prefix: `attachments/${projectId}/` }),
    );
    errors.mockRestore();
  });

  it("deletes a deleted project's icons and attachment files", async () => {
    const owner = clientFor(testDb.db, ada);
    await owner.projects.setIcon({ id: projectId, contentType: "image/png", data: base64(PNG) });
    await testDb.files.bucket.put(`attachments/${projectId}/att_x`, new Uint8Array([1]));
    await owner.projects.delete({ id: projectId });
    expect((await testDb.files.bucket.list()).objects).toHaveLength(0);
  });
});
