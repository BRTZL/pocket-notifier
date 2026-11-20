import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/**
 * A static export, served from Workers static assets on the deployment's root
 * (`packages/infra/alchemy.run.ts`). `worker.ts` serves the Markdown versions of the
 * pages (`/docs/<page>.md`, or `Accept: text/markdown`) from `/llms.mdx/docs/...`.
 *
 * @type {import('next').NextConfig}
 */
const config = {
  output: "export",
  reactStrictMode: true,
  images: { unoptimized: true },
};

export default withMDX(config);
