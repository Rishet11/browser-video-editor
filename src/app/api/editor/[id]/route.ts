import { prisma } from "@/lib/prisma";
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

  const body = (await req.json()) as EDL;

  for (const layer of body.layers) {
    for (const el of layer.elements) {
      if (!isValidStart(el.start)) {
        return Response.json(
          { error: `Invalid start for element ${el.id}: ${el.start}` },
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
