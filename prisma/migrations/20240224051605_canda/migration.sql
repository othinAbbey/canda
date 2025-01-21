/*
  Warnings:

  - You are about to drop the `Location` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Material` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Parish` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Product` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Rate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Region` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Supplier` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Unit` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Location" DROP CONSTRAINT "Location_regionId_fkey";

-- DropForeignKey
ALTER TABLE "Material" DROP CONSTRAINT "Material_parishId_fkey";

-- DropForeignKey
ALTER TABLE "Material" DROP CONSTRAINT "Material_unitsId_fkey";

-- DropForeignKey
ALTER TABLE "Parish" DROP CONSTRAINT "Parish_locationId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_locationId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_materialId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_parishId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_rateId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_unitsId_fkey";

-- DropForeignKey
ALTER TABLE "Rate" DROP CONSTRAINT "Rate_materialId_fkey";

-- DropForeignKey
ALTER TABLE "Rate" DROP CONSTRAINT "Rate_parishId_fkey";

-- DropForeignKey
ALTER TABLE "Rate" DROP CONSTRAINT "Rate_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "Rate" DROP CONSTRAINT "Rate_unitsId_fkey";

-- DropForeignKey
ALTER TABLE "Supplier" DROP CONSTRAINT "Supplier_parishId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_locationId_fkey";

-- DropTable
DROP TABLE "Location";

-- DropTable
DROP TABLE "Material";

-- DropTable
DROP TABLE "Parish";

-- DropTable
DROP TABLE "Product";

-- DropTable
DROP TABLE "Rate";

-- DropTable
DROP TABLE "Region";

-- DropTable
DROP TABLE "Supplier";

-- DropTable
DROP TABLE "Unit";

-- DropTable
DROP TABLE "User";
