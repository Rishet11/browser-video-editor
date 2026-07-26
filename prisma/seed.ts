/**
 * Upserts SEED_EDL into the database under its own stable id, so the app and
 * curl checks always have a known composition to load. Idempotent: replaces
 * layers/elements rather than appending, so running it twice does not
 * duplicate anything.
 */
import { PrismaClient } from "@prisma/client";
import { SEED_EDL } from "../src/lib/seed";
import { fromEDL } from "../src/lib/mapping";

const prisma = new PrismaClient();

async function main() {
  const payload = fromEDL(SEED_EDL);

  await prisma.$transaction(async (tx) => {
    await tx.composition.upsert({
      where: { id: SEED_EDL.id },
      update: {
        name: payload.name,
        duration: payload.duration,
        width: payload.width,
        height: payload.height,
      },
      create: {
        id: SEED_EDL.id,
        name: payload.name,
        duration: payload.duration,
        width: payload.width,
        height: payload.height,
      },
    });

    await tx.layer.deleteMany({ where: { compositionId: SEED_EDL.id } });

    // Bulk inserts, not one create per layer: against a managed Postgres the
    // per-row version accumulates a network round trip per row and blows
    // Prisma's 5s interactive-transaction budget. Same reasoning as
    // `replaceComposition` in src/lib/mapping.ts.
    await tx.layer.createMany({
      data: payload.layers.map((layer) => ({
        id: layer.id,
        compositionId: SEED_EDL.id,
        name: layer.name,
        index: layer.index,
      })),
    });

    await tx.element.createMany({
      data: payload.layers.flatMap((layer) =>
        layer.elements.map((el) => ({
          id: el.id,
          layerId: layer.id,
          type: el.type,
          start: el.start,
          duration: el.duration,
          trimIn: el.trimIn,
          props: el.props,
        })),
      ),
    });
  });

  console.log(`Seeded composition ${SEED_EDL.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
