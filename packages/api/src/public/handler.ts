import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import { publicRouter } from "./router";

/**
 * The `/v1` REST handler. Routes carry the full `/v1/...` path, so it runs without a
 * prefix; the API reference is served at `/v1/docs` and the spec at `/v1/spec.json`.
 */
export function createPublicHandler() {
  return new OpenAPIHandler(publicRouter, {
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
}
