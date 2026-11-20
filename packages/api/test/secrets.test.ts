import { createHash } from "node:crypto";

import { randomBase62, sha256Hex } from "@notifier/db/secrets";
import { describe, expect, it } from "vitest";

const LOWER_HEX_64 = /^[0-9a-f]{64}$/u;

describe("sha256Hex", () => {
  it("matches node:crypto as 64 lowercase hex chars", async () => {
    const texts = ["", "abc", "nt_ünïcode ✓"];
    const hashes = await Promise.all(texts.map((text) => sha256Hex(text)));
    expect(hashes).toEqual(
      texts.map((text) => createHash("sha256").update(text, "utf8").digest("hex")),
    );
    for (const hash of hashes) {
      expect(hash).toMatch(LOWER_HEX_64);
    }
  });
});

describe("randomBase62", () => {
  it("returns exactly the requested number of base62 chars", () => {
    expect(randomBase62(0)).toBe("");
    for (const length of [1, 24, 40, 500]) {
      expect(randomBase62(length)).toMatch(new RegExp(`^[0-9A-Za-z]{${length}}$`, "u"));
    }
    expect(randomBase62(24)).not.toBe(randomBase62(24));
  });

  it("rejects invalid lengths", () => {
    expect(() => randomBase62(-1)).toThrow(RangeError);
    expect(() => randomBase62(1.5)).toThrow(RangeError);
  });

  it("uses every character with roughly equal frequency", () => {
    const sample = randomBase62(62_000);
    const counts = new Map<string, number>();
    for (const char of sample) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    expect(counts.size).toBe(62);
    // Expected 1000 each; modulo bias on the low chars would show as ~1033 vs ~1000,
    // so this only guards against gross mistakes, not subtle bias.
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });
});
