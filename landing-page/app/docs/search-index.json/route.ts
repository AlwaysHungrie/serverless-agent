import { searchIndex } from "@/lib/search";

/**
 * The search index, as one static file.
 *
 * It could be a prop on every docs page instead, and was — but that inlines the
 * whole index into all 22 pages of HTML, re-sent on every navigation. As a file
 * it is built once, fetched once when the dialog is first opened, and cached by
 * the browser for every page after that.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(searchIndex(), {
    headers: { "cache-control": "public, max-age=0, must-revalidate" },
  });
}
