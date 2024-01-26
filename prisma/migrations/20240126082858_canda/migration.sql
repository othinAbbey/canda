/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Mat` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Mat_name_key" ON "Mat"("name");
