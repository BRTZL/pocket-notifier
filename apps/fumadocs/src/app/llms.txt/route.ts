import { docsLlms } from "@/lib/source";

export const revalidate = false;

export async function GET() {
  const response = await docsLlms.serve("/llms.txt");
  return response ?? new Response("Not Found", { status: 404 });
}
