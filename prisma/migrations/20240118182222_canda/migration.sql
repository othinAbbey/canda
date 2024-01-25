/*
  Warnings:

  - A unique constraint covering the columns `[material]` on the table `Material` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Material_material_key" ON "Material"("material");
