import { describe, expect, it } from "vitest";

import { limitBody, PUBLIC_BODY_MAX_BYTES } from "../src/public/body-limit";

const URL = "http://api.test/v1/projects/x/messages";

describe("limitBody", () => {
  it("passes bodies up to the cap through unchanged", async () => {
    const body = "x".repeat(PUBLIC_BODY_MAX_BYTES);
    const limited = await limitBody(
      new Request(URL, { method: "POST", body }),
      PUBLIC_BODY_MAX_BYTES,
    );
    expect(limited).toBeInstanceOf(Request);
    expect(await (limited as Request).text()).toBe(body);
  });

  it("passes requests without a body through", async () => {
    const request = new Request(URL);
    expect(await limitBody(request, 10)).toBe(request);
  });

  it("refuses a declared or counted body over the cap", async () => {
    const declared = await limitBody(
      new Request(URL, { method: "POST", body: "{}", headers: { "Content-Length": "11" } }),
      10,
    );
    expect(declared).toBeInstanceOf(Response);
    expect((declared as Response).status).toBe(413);

    // A lying Content-Length does not get past the counter.
    const counted = await limitBody(
      new Request(URL, {
        method: "POST",
        body: "x".repeat(11),
        headers: { "Content-Length": "1" },
      }),
      10,
    );
    expect((counted as Response).status).toBe(413);
    expect(await (counted as Response).json()).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      data: { maxBytes: 10 },
    });
  });
});
