import { createHash } from "node:crypto";

import { randomBase62, sha256Hex } from "@notifier/db/secrets";
import { describe, expect, it, vi } from "vitest";

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

  it("discards bytes 248-255 instead of mapping them with a modulo", () => {
    // 255 % 62 = 7 and 248 % 62 = 0, so kept biased bytes would show up as "7" or "0".
    const pattern = [255, 248, 10, 250, 61, 249, 251, 252, 253, 254, 0, 247];
    let next = 0;
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      const bytes = array as Uint8Array;
      bytes.forEach((_, index) => {
        bytes[index] = pattern[next % pattern.length] ?? 0;
        next += 1;
      });
      return array;
    });
    try {
      // Kept bytes in order: 10 -> "A", 61 -> "z", 0 -> "0", 247 -> 247 % 62 = 61 -> "z".
      expect(randomBase62(4)).toBe("Az0z");
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
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
