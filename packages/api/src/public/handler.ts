import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import type { PublicContext } from "./base";
import { limitBody, PUBLIC_BODY_MAX_BYTES } from "./body-limit";
import { publicRouter } from "./router";
import { handleUpload, matchUploadPath } from "./upload";

/**
 * The `/v1` REST handler. Routes carry the full `/v1/...` path; the server mounts it
 * under a `prefix` (`/api`). The API reference is served at `<prefix>/v1/docs` and the
 * spec at `<prefix>/v1/spec.json`.
 * Bodies over `maxBodyBytes` get a 413 before oRPC buffers or parses them, except
 * attachment uploads: those stream to R2 through `./upload`, up to `ATTACHMENT_MAX_BYTES`.
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
    async handle(request: Request, options: { context: PublicContext; prefix?: `/${string}` }) {
      const { pathname } = new URL(request.url);
      const prefix = options.prefix ?? "";
      const uploadProject = pathname.startsWith(prefix)
        ? matchUploadPath(pathname.slice(prefix.length))
        : null;
      if (uploadProject !== null) {
        return {
          matched: true as const,
          response: await handleUpload(request, uploadProject, options.context),
        };
      }
      const limited = await limitBody(request, maxBodyBytes);
      if (limited instanceof Response) {
        return { matched: true as const, response: limited };
      }
      return await handler.handle(limited, options);
    },
  };
}
