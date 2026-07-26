import { prisma } from "@/lib/prisma";
import { readJson, parseEDL } from "@/lib/parseBody";
import { toEDL, replaceComposition } from "@/lib/mapping";
import { isValidStart, isValidDuration } from "@/lib/validate";
import type { EDL } from "@/lib/edl";

export const dynamic = "force-dynamic";

async function loadComposition(id: string) {
  return prisma.composition.findUnique({
    where: { id },
    include: {
      layers: {
        orderBy: { index: "asc" },
        include: { elements: true },
      },
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const composition = await loadComposition(id);
  if (!composition) {
    return Response.json({ error: "Composition not found" }, { status: 404 });
  }
  return Response.json(toEDL(composition));
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await loadComposition(id);
  if (!existing) {
    return Response.json({ error: "Composition not found" }, { status: 404 });
  }

  const json = await readJson(req);
  if (!json.ok) {
    return Response.json({ error: json.error }, { status: 400 });
  }
  const parsed = parseEDL(json.value);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.value;

  for (const layer of body.layers) {
    for (const el of layer.elements) {
      if (!isValidStart(el.start)) {
        return Response.json(
          { error: `Invalid start for element ${el.id}: ${el.start}` },
          { status: 400 },
        );
      }
      // trimIn is checked here too, not just in the per-element PATCH route.
      // Autosave sends whole compositions through this endpoint, so a gap here
      // would be the one way an invalid trimIn could reach the database.
      if (!Number.isFinite(el.trimIn) || el.trimIn < 0) {
        return Response.json(
          { error: `Invalid trimIn for element ${el.id}: ${el.trimIn}` },
          { status: 400 },
        );
      }
      if (!isValidDuration(el.duration)) {
        return Response.json(
          { error: `Invalid duration for element ${el.id}: ${el.duration}` },
          { status: 400 },
        );
      }
    }
  }

  const edl = await replaceComposition(prisma, id, body);
  return Response.json(edl);
}
