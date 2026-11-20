import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/source";

// The site is a static export, so the search index is a file the browser searches itself.
// It is not under `/api`: on the deployment that path belongs to the server Worker.
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source);
