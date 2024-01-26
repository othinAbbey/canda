/*
  Warnings:

  - You are about to drop the column `name` on the `Material` table. All the data in the column will be lost.
  - Added the required column `material` to the `Material` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Material" DROP COLUMN "name",
ADD COLUMN     "material" TEXT NOT NULL;
