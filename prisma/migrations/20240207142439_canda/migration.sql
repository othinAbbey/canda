-- AlterTable
ALTER TABLE "Structures" ADD COLUMN     "dimensionsId" INTEGER;

-- AddForeignKey
ALTER TABLE "Structures" ADD CONSTRAINT "Structures_dimensionsId_fkey" FOREIGN KEY ("dimensionsId") REFERENCES "Dimensions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
