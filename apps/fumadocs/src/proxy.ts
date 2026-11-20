import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";
import { type NextRequest, NextResponse } from "next/server";

import { docsRoute } from "@/lib/shared";

const { rewrite: rewriteDocs } = rewritePath(
  `${docsRoute}{/*path}`,
  `/llms.mdx${docsRoute}{/*path}.md`,
);

const MARKDOWN_FILE = /\.(?:md|txt)$/u;

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // files like `/docs/page.md` are served by the rewrites of the Next.js config
  const result =
    isMarkdownPreferred(request) && !MARKDOWN_FILE.test(pathname) && rewriteDocs(pathname);

  if (result) {
    return NextResponse.rewrite(new URL(result, request.nextUrl), {
      // this URL has two representations, selected by `Accept`
      headers: { Vary: "Accept" },
    });
  }

  return NextResponse.next();
}
