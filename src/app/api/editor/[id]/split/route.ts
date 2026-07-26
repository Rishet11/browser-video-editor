import { prisma } from "@/lib/prisma";
import { toEDL, replaceComposition } from "@/lib/mapping";
import { splitElement } from "@/lib/edl";

export const dynamic = "force-dynamic";

interface SplitBody {
  elementId: string;
  atTime: number;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const composition = await prisma.composition.findUnique({
    where: { id },
    include: {
      layers: {
        orderBy: { index: "asc" },
        include: { elements: true },
      },
    },
  });

  if (!composition) {
    return Response.json({ error: "Composition not found" }, { status: 404 });
  }

  const body = (await req.json()) as SplitBody;
  const edl = toEDL(composition);
  const result = splitElement(edl, body.elementId, body.atTime);

  if (result === edl) {
    return Response.json({ error: "split rejected" }, { status: 400 });
  }

  const saved = await replaceComposition(prisma, id, result);
  return Response.json(saved);
}
