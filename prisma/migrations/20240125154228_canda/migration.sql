-- AlterTable
ALTER TABLE "Rate" ADD COLUMN     "dimensionsId" INTEGER,
ADD COLUMN     "structuresId" INTEGER;

-- CreateTable
CREATE TABLE "Dimensions" (
    "id" SERIAL NOT NULL,
    "length" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" INTEGER,

    CONSTRAINT "Dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Structures" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" INTEGER,

    CONSTRAINT "Structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mat" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dimensionsId" INTEGER,

    CONSTRAINT "Mat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StructuresMaterials" (
    "structureId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,

    CONSTRAINT "StructuresMaterials_pkey" PRIMARY KEY ("structureId","materialId")
);

-- CreateTable
CREATE TABLE "_StructuresMaterials" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_StructuresMaterials_AB_unique" ON "_StructuresMaterials"("A", "B");

-- CreateIndex
CREATE INDEX "_StructuresMaterials_B_index" ON "_StructuresMaterials"("B");

-- AddForeignKey
ALTER TABLE "Rate" ADD CONSTRAINT "Rate_dimensionsId_fkey" FOREIGN KEY ("dimensionsId") REFERENCES "Dimensions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rate" ADD CONSTRAINT "Rate_structuresId_fkey" FOREIGN KEY ("structuresId") REFERENCES "Structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dimensions" ADD CONSTRAINT "Dimensions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Structures" ADD CONSTRAINT "Structures_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mat" ADD CONSTRAINT "Mat_dimensionsId_fkey" FOREIGN KEY ("dimensionsId") REFERENCES "Dimensions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StructuresMaterials" ADD CONSTRAINT "StructuresMaterials_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StructuresMaterials" ADD CONSTRAINT "StructuresMaterials_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Mat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StructuresMaterials" ADD CONSTRAINT "_StructuresMaterials_A_fkey" FOREIGN KEY ("A") REFERENCES "Mat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_StructuresMaterials" ADD CONSTRAINT "_StructuresMaterials_B_fkey" FOREIGN KEY ("B") REFERENCES "Structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
