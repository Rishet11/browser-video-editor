/**
 * POST /api/editor/import
 *
 * The assignment brief's "load an HTML composition" is ambiguous: it could
 * mean loading a stored composition that renders as DOM (already covered by
 * GET /api/editor/{id}), or parsing a supplied HTML file into elements. This
 * route exists to satisfy the second reading: it parses raw HTML into an EDL
 * and persists it as a brand-new composition.
 */
import { prisma } from "@/lib/prisma";
import { toEDL, fromEDL } from "@/lib/mapping";
import { parseHtmlToEDL } from "@/lib/importHtml";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  let html: string;
  let name: string | undefined;

  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { html?: string; name?: string };
      html = body.html ?? "";
      name = body.name;
    } else {
      html = await req.text();
    }
  } catch {
    return Response.json({ error: "Could not read request body" }, { status: 400 });
  }

  if (!html || !html.trim()) {
    return Response.json({ error: "No HTML provided" }, { status: 400 });
  }

  let edl;
  try {
    edl = parseHtmlToEDL(html, { name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse HTML";
    return Response.json({ error: message }, { status: 400 });
  }

  const payload = fromEDL(edl);

  const created = await prisma.composition.create({
    data: {
      name: payload.name,
      duration: payload.duration,
      width: payload.width,
      height: payload.height,
      // Layer and element ids are deliberately NOT carried over from the parse.
      // `parseHtmlToEDL` numbers them deterministically (import-l0, import-e0…)
      // so it stays unit-testable, but those are primary keys here: persisting
      // them verbatim means importing the same document twice collides on a
      // unique constraint and 500s. Letting Prisma's @default(cuid()) assign
      // them keeps every import independent.
      layers: {
        create: payload.layers.map((layer) => ({
          name: layer.name,
          index: layer.index,
          elements: {
            create: layer.elements.map((el) => ({
              type: el.type,
              start: el.start,
              duration: el.duration,
              trimIn: el.trimIn,
              props: el.props,
            })),
          },
        })),
      },
    },
    include: {
      layers: {
        orderBy: { index: "asc" },
        include: { elements: true },
      },
    },
  });

  return Response.json(toEDL(created), { status: 201 });
}
