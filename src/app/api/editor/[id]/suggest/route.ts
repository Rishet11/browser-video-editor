import { prisma } from "@/lib/prisma";
import { toEDL } from "@/lib/mapping";
import { buildSuggestionPrompt, requestSuggestions, parseSuggestions } from "@/lib/suggestions";

export const dynamic = "force-dynamic";

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
        include: { elements: { orderBy: [{ start: "asc" }, { id: "asc" }] } },
      },
    },
  });

  if (!composition) {
    return Response.json({ error: "Composition not found" }, { status: 404 });
  }

  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: "AI suggestions are not configured (GROQ_API_KEY is unset)." },
      { status: 503 },
    );
  }

  const edl = toEDL(composition);
  const prompt = buildSuggestionPrompt(edl);

  let content: string;
  let model: string;
  try {
    const result = await requestSuggestions(prompt);
    content = result.content;
    model = result.model;
  } catch {
    return Response.json(
      { error: "Failed to get suggestions from the AI provider." },
      { status: 502 },
    );
  }

  const suggestions = parseSuggestions(content, edl);
  return Response.json({ suggestions, model });
}
