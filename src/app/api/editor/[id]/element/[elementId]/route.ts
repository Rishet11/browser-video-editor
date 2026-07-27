import { prisma } from "@/lib/prisma";
import { readJson, parseElementPatch } from "@/lib/parseBody";
import { toEDL, mergeProps } from "@/lib/mapping";
import { isValidStart, isValidDuration } from "@/lib/validate";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

interface ElementPatchBody {
  start?: number;
  duration?: number;
  trimIn?: number;
  props?: Record<string, unknown>;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; elementId: string }> },
) {
  const { id, elementId } = await params;

  const element = await prisma.element.findUnique({
    where: { id: elementId },
    include: { layer: true },
  });

  if (!element || element.layer.compositionId !== id) {
    return Response.json({ error: "Element not found" }, { status: 404 });
  }

  const json = await readJson(req);
  if (!json.ok) {
    return Response.json({ error: json.error }, { status: 400 });
  }
  const parsed = parseElementPatch(json.value);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const body: ElementPatchBody = parsed.value;

  const data: Prisma.ElementUpdateInput = {};

  if (body.start !== undefined) {
    if (!isValidStart(body.start)) {
      return Response.json(
        { error: `Invalid start: ${body.start}` },
        { status: 400 },
      );
    }
    data.start = body.start;
  }

  if (body.duration !== undefined) {
    if (!isValidDuration(body.duration)) {
      return Response.json(
        { error: `Invalid duration: ${body.duration} (must be >= MIN_DURATION)` },
        { status: 400 },
      );
    }
    data.duration = body.duration;
  }

  if (body.trimIn !== undefined) {
    if (!Number.isFinite(body.trimIn) || body.trimIn < 0) {
      return Response.json(
        { error: `Invalid trimIn: ${body.trimIn}` },
        { status: 400 },
      );
    }
    data.trimIn = body.trimIn;
  }

  if (body.props !== undefined) {
    const existingProps =
      element.props !== null &&
      typeof element.props === "object" &&
      !Array.isArray(element.props)
        ? (element.props as Record<string, unknown>)
        : null;
    data.props = mergeProps(existingProps, body.props) as Prisma.InputJsonValue;
  }

  await prisma.element.update({
    where: { id: elementId },
    data,
  });

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

  return Response.json(toEDL(composition));
}
