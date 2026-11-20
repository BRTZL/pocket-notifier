import { device } from "@notifier/db/schema/notifier";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./db";
import { clientFor, definedError, nextMillisecond, seedUser, type TestUser } from "./helpers";

const DEVICE_ID = /^dev_/u;

describe("devices", () => {
  let testDb: TestDb;
  let ada: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    testDb = await createTestDb();
    ada = await seedUser(testDb.db, "ada");
    bob = await seedUser(testDb.db, "bob");
  });

  afterEach(async () => {
    await testDb.dispose();
  });

  it("upserts by push token", async () => {
    const client = clientFor(testDb.db, ada);
    const first = await client.devices.register({
      pushToken: "fcm-1",
      name: "Pixel",
      platform: "android",
    });
    expect(first).toMatchObject({
      id: expect.stringMatching(DEVICE_ID),
      name: "Pixel",
      platform: "android",
      appVersion: null,
    });
    await nextMillisecond();
    const again = await client.devices.register({
      pushToken: "fcm-1",
      name: "Pixel 9",
      platform: "android",
      appVersion: "1.2.0",
    });
    expect(again).toMatchObject({
      id: first.id,
      name: "Pixel 9",
      appVersion: "1.2.0",
      createdAt: first.createdAt,
    });
    expect(Date.parse(again.lastSeenAt)).toBeGreaterThan(Date.parse(first.lastSeenAt));
    expect(await testDb.db.$count(device)).toBe(1);
  });

  it("moves a push token to the user who registers it", async () => {
    const adaDevice = await clientFor(testDb.db, ada).devices.register({
      pushToken: "fcm-shared",
      name: "Old phone",
      platform: "android",
    });
    const bobDevice = await clientFor(testDb.db, bob).devices.register({
      pushToken: "fcm-shared",
      name: "Bob's phone",
      platform: "android",
    });
    expect(bobDevice.id).toBe(adaDevice.id);
    expect(await clientFor(testDb.db, ada).devices.list()).toEqual([]);
    expect(await clientFor(testDb.db, bob).devices.list()).toEqual([bobDevice]);
  });

  it("lists own devices by last seen, renames and removes them", async () => {
    const client = clientFor(testDb.db, ada);
    const older = await client.devices.register({ pushToken: "a", name: "A", platform: "android" });
    await nextMillisecond();
    const newer = await client.devices.register({ pushToken: "b", name: "B", platform: "ios" });
    await clientFor(testDb.db, bob).devices.register({
      pushToken: "c",
      name: "C",
      platform: "android",
    });
    expect((await client.devices.list()).map((d) => d.id)).toEqual([newer.id, older.id]);

    await expect(client.devices.rename({ id: older.id, name: "Work" })).resolves.toMatchObject({
      id: older.id,
      name: "Work",
    });
    const bobClient = clientFor(testDb.db, bob);
    await expect(bobClient.devices.rename({ id: older.id, name: "Mine" })).rejects.toMatchObject(
      definedError("NOT_FOUND"),
    );
    await expect(bobClient.devices.remove({ id: older.id })).rejects.toMatchObject(
      definedError("NOT_FOUND"),
    );
    await expect(client.devices.remove({ id: older.id })).resolves.toEqual({ ok: true });
    expect((await client.devices.list()).map((d) => d.id)).toEqual([newer.id]);
  });
});
