import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import type { PublicContext } from "./base";
import { limitBody, PUBLIC_BODY_MAX_BYTES } from "./body-limit";
import { publicRouter } from "./router";

/**
 * The `/v1` REST handler. Routes carry the full `/v1/...` path, so it runs without a
 * prefix; the API reference is served at `/v1/docs` and the spec at `/v1/spec.json`.
 * Bodies over `maxBodyBytes` get a 413 before oRPC buffers or parses them.
 */
export function createPublicHandler({ maxBodyBytes = PUBLIC_BODY_MAX_BYTES } = {}) {
  const handler = new OpenAPIHandler(publicRouter, {
    plugins: [
      new OpenAPIReferencePlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
        docsPath: "/v1/docs",
        specPath: "/v1/spec.json",
        docsTitle: "notifier API",
        specGenerateOptions: {
          info: { title: "notifier API", version: "1" },
          components: {
            securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
          },
          security: [{ bearer: [] }],
        },
      }),
    ],
    interceptors: [
      onError((error) => {
        console.error(error);
      }),
    ],
  });

  return {
    async handle(request: Request, options: { context: PublicContext }) {
      const limited = await limitBody(request, maxBodyBytes);
      if (limited instanceof Response) {
        return { matched: true as const, response: limited };
      }
      return await handler.handle(limited, options);
    },
  };
}
