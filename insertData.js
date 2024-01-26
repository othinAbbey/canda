const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Insert data into Dimensions
  const dimension = await prisma.dimensions.create({
    data: {
      length: 400,
      width: 200,
      height: 150,
      volume: (150 * 200* 400)/1000000,
    },
  });

  // Insert data into Materials
  const material = await prisma.mat.create({
    data: {
      name: 'Hollow Block',
      dimensionsId: dimension.id, // Reference the ID of the dimension created above
    },
  });

  // Insert data into Structures
  const structure = await prisma.structures.create({
    data: {
      name: 'Internal Wall',
     
    },
  });


  // Create a relationship in StructuresMaterials
  await prisma.structuresMaterials.create({
    data: {
      structureId: structure.id,
      materialId: material.id,
    },
  });

  console.log('Data inserted successfully');
}

main()
  .catch((e) => {
    throw e;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
