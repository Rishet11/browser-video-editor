import { prisma } from "@/lib/prisma";
import { toEDL } from "@/lib/mapping";
import { renderStandaloneHtml } from "@/lib/exportHtml";

export const dynamic = "force-dynamic";

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "composition";
}

export async function POST(
  _req: Request,
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

  const edl = toEDL(composition);
  const html = renderStandaloneHtml(edl);
  const filename = `${slugify(edl.name)}.html`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
