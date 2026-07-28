// Parse raw HTML into an EDL and persist as a new composition.
// (Distinguishes from GET /api/editor/{id}, which retrieves stored HTML.)
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
      // Skip IDs from the parse. parseHtmlToEDL uses deterministic names for testing,
      // but they're PKs here—re-importing the same doc would collide. Let Prisma
      // generate new ones (@default(cuid())) so each import stays independent.
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
        include: { elements: { orderBy: [{ start: "asc" }, { id: "asc" }] } },
      },
    },
  });

  return Response.json(toEDL(created), { status: 201 });
}
