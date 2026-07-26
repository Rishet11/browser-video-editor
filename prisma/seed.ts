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

    for (const layer of payload.layers) {
      await tx.layer.create({
        data: {
          id: layer.id,
          compositionId: SEED_EDL.id,
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
