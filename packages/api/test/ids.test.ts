import { ID_PREFIXES, type IdKind, idSchema } from "@notifier/contract/common";
import { newId } from "@notifier/db/ids";
import { afterEach, describe, expect, it, vi } from "vitest";

const kinds = Object.keys(ID_PREFIXES) as IdKind[];

describe("newId", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(kinds)("matches idSchema(%s)", (kind) => {
    const id = newId(kind);
    expect(idSchema(kind).safeParse(id).success).toBe(true);
    expect(id.startsWith(`${ID_PREFIXES[kind]}_`)).toBe(true);
  });

  it("sorts IDs from later milliseconds after earlier ones", () => {
    vi.useFakeTimers();
    const ids: string[] = [];
    for (const time of [1, 31, 32, 1000, 1_732_105_600_000, 1_732_105_600_001, 2 ** 48 - 1]) {
      vi.setSystemTime(time);
      ids.push(newId("message"));
    }
    // Plain code-unit order, the same order SQLite uses for text keys.
    expect(ids.toSorted((a, b) => (a < b ? -1 : 1))).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("creates 1000 unique IDs", () => {
    const ids = Array.from({ length: 1000 }, () => newId("topic"));
    expect(new Set(ids).size).toBe(1000);
  });
});
