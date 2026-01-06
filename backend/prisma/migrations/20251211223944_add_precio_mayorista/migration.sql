/*
  Warnings:

  - You are about to drop the column `costo_real` on the `productos` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "idx_prod_nombre_trgm";

-- AlterTable
ALTER TABLE "categorias" ADD COLUMN     "margen_minimo" DECIMAL(5,2),
ADD COLUMN     "margen_recomendado" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "productos" DROP COLUMN "costo_real",
ADD COLUMN     "precio_mayorista" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "idx_prod_nombre_trgm" ON "productos" USING GIN ("nombre" gin_trgm_ops);
