/**
 * The ONLY place DB shape and EDL shape touch. Route handlers must go through
 * `toEDL` / `fromEDL` (and `replaceComposition` for the shared persistence
 * path) rather than reading/writing Prisma models directly.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { EDL, BaseElement, ElementType } from "./edl";

type ElementRow = {
  id: string;
  layerId: string;
  type: string;
  start: number;
  duration: number;
  trimIn: number;
  props: Prisma.JsonValue;
};

type LayerRow = {
  id: string;
  name: string;
  index: number;
  elements: ElementRow[];
};

export type CompositionWithRelations = {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  layers: LayerRow[];
};

function coerceProps(value: Prisma.JsonValue): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** DB row -> flat EDL. Assumes layers/elements are already ordered by index. */
export function toEDL(composition: CompositionWithRelations): EDL {
  return {
    id: composition.id,
    name: composition.name,
    duration: composition.duration,
    width: composition.width,
    height: composition.height,
    layers: composition.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      index: layer.index,
      elements: layer.elements.map(
        (el): BaseElement => ({
          id: el.id,
          layerId: el.layerId,
          type: el.type as ElementType,
          start: el.start,
          duration: el.duration,
          trimIn: el.trimIn,
          props: coerceProps(el.props),
        }),
      ),
    })),
  };
}

/** EDL -> nested-write payload for recreating layers/elements. Pure data, no I/O. */
export function fromEDL(edl: EDL) {
  return {
    name: edl.name,
    duration: edl.duration,
    width: edl.width,
    height: edl.height,
    layers: edl.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      index: layer.index,
      elements: layer.elements.map((el) => ({
        id: el.id,
        type: el.type,
        start: el.start,
        duration: el.duration,
        trimIn: el.trimIn,
        props: el.props as Prisma.InputJsonValue,
      })),
    })),
  };
}

/**
 * Shared persistence path for PUT and split: delete-then-recreate all layers
 * (cascade removes elements) inside one transaction, then re-read via toEDL
 * so the response is authoritative rather than an echo of the input.
 *
 * Delete-then-recreate is a deliberate simplicity trade-off over diffing;
 * it is idempotent and correct for our scale, at the cost of churning ids
 * for rows that would otherwise be unchanged (ids are preserved from the
 * incoming EDL, so this is a non-issue for callers that already have one).
 */
export async function replaceComposition(
  prisma: PrismaClient,
  id: string,
  edl: EDL,
): Promise<EDL> {
  const payload = fromEDL(edl);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.composition.update({
      where: { id },
      data: {
        name: payload.name,
        duration: payload.duration,
        width: payload.width,
        height: payload.height,
      },
    });

    await tx.layer.deleteMany({ where: { compositionId: id } });

    for (const layer of payload.layers) {
      await tx.layer.create({
        data: {
          id: layer.id,
          compositionId: id,
          name: layer.name,
          index: layer.index,
          elements: {
            create: layer.elements.map((el) => ({
              id: el.id,
              type: el.type,
              start: el.start,
              duration: el.duration,
              trimIn: el.trimIn,
              props: el.props,
            })),
          },
        },
      });
    }

    return tx.composition.findUnique({
      where: { id },
      include: {
        layers: {
          orderBy: { index: "asc" },
          include: { elements: true },
        },
      },
    });
  });

  if (!updated) {
    throw new Error(`Composition ${id} disappeared during transaction`);
  }

  return toEDL(updated);
}
