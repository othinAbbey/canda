/*
  Warnings:

  - You are about to drop the column `createdAt` on the `Location` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Location` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Location` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Location` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `material` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Rate` table. All the data in the column will be lost.
  - You are about to drop the column `dimensionsId` on the `Rate` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `Rate` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `Rate` table. All the data in the column will be lost.
  - You are about to drop the column `structuresId` on the `Rate` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Rate` table. All the data in the column will be lost.
  - You are about to drop the column `contact` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `locationId` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the `Dimensions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Mat` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Structures` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StructuresMaterials` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_StructuresMaterials` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `locationName` to the `Location` table without a default value. This is not possible if the table is not empty.
  - Added the required column `regionId` to the `Location` table without a default value. This is not possible if the table is not empty.
  - Added the required column `materialName` to the `Material` table without a default value. This is not possible if the table is not empty.
  - Added the required column `parishId` to the `Material` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unitsId` to the `Material` table without a default value. This is not possible if the table is not empty.
  - Added the required column `parishId` to the `Rate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rateValue` to the `Rate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unitsId` to the `Rate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `parishId` to the `Supplier` table without a default value. This is not possible if the table is not empty.
  - Added the required column `supplierName` to the `Supplier` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Dimensions" DROP CONSTRAINT "Dimensions_locationId_fkey";

-- DropForeignKey
ALTER TABLE "Mat" DROP CONSTRAINT "Mat_dimensionsId_fkey";

-- DropForeignKey
ALTER TABLE "Material" DROP CONSTRAINT "Material_locationId_fkey";

-- DropForeignKey
ALTER TABLE "Rate" DROP CONSTRAINT "Rate_dimensionsId_fkey";

-- DropForeignKey
ALTER TABLE "Rate" DROP CONSTRAINT "Rate_locationId_fkey";

-- DropForeignKey
ALTER TABLE "Rate" DROP CONSTRAINT "Rate_structuresId_fkey";

-- DropForeignKey
ALTER TABLE "Structures" DROP CONSTRAINT "Structures_dimensionsId_fkey";

-- DropForeignKey
ALTER TABLE "Structures" DROP CONSTRAINT "Structures_locationId_fkey";

-- DropForeignKey
ALTER TABLE "StructuresMaterials" DROP CONSTRAINT "StructuresMaterials_materialId_fkey";

-- DropForeignKey
ALTER TABLE "StructuresMaterials" DROP CONSTRAINT "StructuresMaterials_structureId_fkey";

-- DropForeignKey
ALTER TABLE "Supplier" DROP CONSTRAINT "Supplier_locationId_fkey";

-- DropForeignKey
ALTER TABLE "_StructuresMaterials" DROP CONSTRAINT "_StructuresMaterials_A_fkey";

-- DropForeignKey
ALTER TABLE "_StructuresMaterials" DROP CONSTRAINT "_StructuresMaterials_B_fkey";

-- DropIndex
DROP INDEX "Material_material_key";

-- AlterTable
ALTER TABLE "Location" DROP COLUMN "createdAt",
DROP COLUMN "description",
DROP COLUMN "name",
DROP COLUMN "updatedAt",
ADD COLUMN     "locationName" TEXT NOT NULL,
ADD COLUMN     "regionId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Material" DROP COLUMN "createdAt",
DROP COLUMN "description",
DROP COLUMN "locationId",
DROP COLUMN "material",
DROP COLUMN "name",
DROP COLUMN "updatedAt",
ADD COLUMN     "materialName" TEXT NOT NULL,
ADD COLUMN     "parishId" INTEGER NOT NULL,
ADD COLUMN     "unitsId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Rate" DROP COLUMN "createdAt",
DROP COLUMN "dimensionsId",
DROP COLUMN "locationId",
DROP COLUMN "price",
DROP COLUMN "structuresId",
DROP COLUMN "updatedAt",
ADD COLUMN     "parishId" INTEGER NOT NULL,
ADD COLUMN     "rateValue" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "unitsId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Supplier" DROP COLUMN "contact",
DROP COLUMN "createdAt",
DROP COLUMN "locationId",
DROP COLUMN "name",
DROP COLUMN "updatedAt",
ADD COLUMN     "parishId" INTEGER NOT NULL,
ADD COLUMN     "supplierName" TEXT NOT NULL;

-- DropTable
DROP TABLE "Dimensions";

-- DropTable
DROP TABLE "Mat";

-- DropTable
DROP TABLE "Structures";

-- DropTable
DROP TABLE "StructuresMaterials";

-- DropTable
DROP TABLE "_StructuresMaterials";

-- CreateTable
CREATE TABLE "Region" (
    "id" SERIAL NOT NULL,
    "regionName" TEXT NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parish" (
    "id" SERIAL NOT NULL,
    "parishName" TEXT NOT NULL,
    "locationId" INTEGER NOT NULL,

    CONSTRAINT "Parish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" SERIAL NOT NULL,
    "unitName" TEXT NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "productName" TEXT NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "parishId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "unitsId" INTEGER NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parish" ADD CONSTRAINT "Parish_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_parishId_fkey" FOREIGN KEY ("parishId") REFERENCES "Parish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_unitsId_fkey" FOREIGN KEY ("unitsId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rate" ADD CONSTRAINT "Rate_parishId_fkey" FOREIGN KEY ("parishId") REFERENCES "Parish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rate" ADD CONSTRAINT "Rate_unitsId_fkey" FOREIGN KEY ("unitsId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_parishId_fkey" FOREIGN KEY ("parishId") REFERENCES "Parish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_parishId_fkey" FOREIGN KEY ("parishId") REFERENCES "Parish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_unitsId_fkey" FOREIGN KEY ("unitsId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
