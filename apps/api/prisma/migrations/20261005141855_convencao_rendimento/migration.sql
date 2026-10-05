-- CreateEnum
CREATE TYPE "ConvencaoRendimento" AS ENUM ('MOVIMENTO_ANTES_DO_RENDIMENTO', 'MOVIMENTO_DEPOIS_DO_RENDIMENTO');

-- AlterTable
ALTER TABLE "Caixinha" ADD COLUMN     "convencaoRendimento" "ConvencaoRendimento";
