import { ERRORS } from "@notifier/contract/errors";

/** Cap for `/v1` JSON bodies. A publish is about 4 KB of text plus actions. */
export const PUBLIC_BODY_MAX_BYTES = 64 * 1024;

/** The contract's `PAYLOAD_TOO_LARGE` error, in the shape oRPC's OpenAPI handler sends. */
export function payloadTooLarge(maxBytes: number): Response {
  const { status, message } = ERRORS.PAYLOAD_TOO_LARGE;
  return Response.json(
    { defined: true, code: "PAYLOAD_TOO_LARGE", status, message, data: { maxBytes } },
    { status },
  );
}

/**
 * Reads the body up to `maxBytes` before anything parses it. A declared
 * `Content-Length` over the cap is refused without reading; a body without one is
 * counted while it streams and dropped as soon as it passes the cap. Returns a request
 * with the buffered body, or the 413 response.
 */
export async function limitBody(request: Request, maxBytes: number): Promise<Request | Response> {
  if (!request.body) {
    return request;
  }
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > maxBytes) {
    await request.body.cancel();
    return payloadTooLarge(maxBytes);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    // Chunks must be read in order; there is nothing to parallelise.
    // biome-ignore lint/performance/noAwaitInLoops: sequential stream read.
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return payloadTooLarge(maxBytes);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { method: request.method, body });
}
