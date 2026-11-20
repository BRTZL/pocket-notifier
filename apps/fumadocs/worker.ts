/**
 * The docs site's Worker. The site itself is a static export (`out/`) served from
 * Workers static assets; this Worker only runs for `/docs` and `/docs/*` and serves the Markdown
 * version of a page, which the build writes to `/llms.mdx/docs/<page>.md`:
 *
 * - `/docs/<page>.md` always gets the Markdown file.
 * - `/docs/<page>` gets it when the client asks for `text/markdown` (agents), else HTML.
 *
 * Everything else, including the `.txt` payloads Next.js fetches on navigation, goes to
 * the assets unchanged.
 */

type Env = { ASSETS: { fetch: (request: Request | URL | string) => Promise<Response> } };

const DOCS = /^\/docs(?:\/.*)?$/u;
const MARKDOWN_FILE = /\.md$/u;
const OTHER_FILE = /\.[a-z0-9]+$/iu;
const TRAILING_SLASHES = /\/+$/u;

/** True when `text/markdown` is accepted and ranked at least as high as `text/html`. */
function prefersMarkdown(accept: string | null): boolean {
  if (!accept) {
    return false;
  }
  const quality = (type: string) => {
    for (const part of accept.split(",")) {
      const [name, ...params] = part.trim().split(";");
      if (name?.trim().toLowerCase() === type) {
        const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
        return q ? Number(q.slice(2)) : 1;
      }
    }
    return 0;
  };
  const markdown = quality("text/markdown");
  return markdown > 0 && markdown >= quality("text/html");
}

/** The asset path of the Markdown version of `pathname`, or `null` to serve it as is. */
export function markdownPath(pathname: string, accept: string | null): string | null {
  if (!DOCS.test(pathname)) {
    return null;
  }
  if (MARKDOWN_FILE.test(pathname)) {
    return `/llms.mdx${pathname}`;
  }
  if (OTHER_FILE.test(pathname) || !prefersMarkdown(accept)) {
    return null;
  }
  return `/llms.mdx${pathname.replace(TRAILING_SLASHES, "")}.md`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const markdown = markdownPath(url.pathname, request.headers.get("Accept"));
    if (!markdown) {
      return env.ASSETS.fetch(request);
    }
    const asset = await env.ASSETS.fetch(new URL(markdown, url));
    if (!asset.ok) {
      return asset;
    }
    const response = new Response(asset.body, asset);
    response.headers.set("Content-Type", "text/markdown; charset=utf-8");
    // `/docs/<page>` has two representations, selected by `Accept`.
    response.headers.set("Vary", "Accept");
    return response;
  },
};
