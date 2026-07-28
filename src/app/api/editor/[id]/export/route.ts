import { prisma } from "@/lib/prisma";
import { toEDL } from "@/lib/mapping";
import { renderStandaloneHtml } from "@/lib/exportHtml";
import type { EDL } from "@/lib/edl";

export const dynamic = "force-dynamic";

// Convert root-relative asset paths to absolute URLs.
// Exported HTML opens via file:// where /demo/clip.mp4 would resolve to the
// filesystem root and silently fail. Only we know the deployment origin.
function absolutiseAssets(edl: EDL, origin: string): EDL {
  const fix = (value: unknown) =>
    typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
      ? `${origin}${value}`
      : value;

  return {
    ...edl,
    layers: edl.layers.map((layer) => ({
      ...layer,
      elements: layer.elements.map((el) =>
        typeof el.props.src === "string"
          ? { ...el, props: { ...el.props, src: fix(el.props.src) } }
          : el,
      ),
    })),
  };
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "composition";
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
        include: { elements: { orderBy: [{ start: "asc" }, { id: "asc" }] } },
      },
    },
  });

  if (!composition) {
    return Response.json({ error: "Composition not found" }, { status: 404 });
  }

  const edl = absolutiseAssets(toEDL(composition), new URL(req.url).origin);
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
