// The ONLY place DB shape and EDL shape touch. Route handlers go through
// toEDL/fromEDL (and replaceComposition for writes), never Prisma directly.
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

// Shallow on purpose: nested objects like `css` are replaced wholesale —
// a deep merge would leave a caller no way to remove a key from `css`.
export function mergeProps(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(existing ?? {}), ...incoming };
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

// Shared write path for PUT and split: delete-then-recreate all layers
// (elements cascade) in one transaction, then re-read via toEDL so the
// response is authoritative rather than an echo of the input.
//
// Delete-then-recreate over diffing on purpose: idempotent and fine at this
// scale, at the cost of churning rows. Ids come from the incoming EDL anyway.
//
// Two createMany calls, not a nested create per layer, so the transaction is
// a FIXED five round trips regardless of size. A per-row loop over the network
// accumulates a round trip per row and blew Prisma's 5s interactive-transaction
// limit (P2028) against remote Postgres while passing locally. createMany needs
// no returned rows — the authoritative EDL is re-read at the end anyway.
export async function replaceComposition(
  prisma: PrismaClient,
  id: string,
  edl: EDL,
): Promise<EDL> {
  const payload = fromEDL(edl);

  const layerRows = payload.layers.map((layer) => ({
    id: layer.id,
    compositionId: id,
    name: layer.name,
    index: layer.index,
  }));

  const elementRows = payload.layers.flatMap((layer) =>
    layer.elements.map((el) => ({
      id: el.id,
      layerId: layer.id,
      type: el.type,
      start: el.start,
      duration: el.duration,
      trimIn: el.trimIn,
      props: el.props,
    })),
  );

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

    if (layerRows.length > 0) {
      await tx.layer.createMany({ data: layerRows });
    }
    if (elementRows.length > 0) {
      await tx.element.createMany({ data: elementRows });
    }

    return tx.composition.findUnique({
      where: { id },
      include: {
        layers: {
          orderBy: { index: "asc" },
          include: { elements: { orderBy: [{ start: "asc" }, { id: "asc" }] } },
        },
      },
    });
  });

  if (!updated) {
    throw new Error(`Composition ${id} disappeared during transaction`);
  }

  return toEDL(updated);
}
