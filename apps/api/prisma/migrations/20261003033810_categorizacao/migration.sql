-- CreateEnum
CREATE TYPE "OrigemCategoria" AS ENUM ('REGRA_USUARIO', 'REGRA_PADRAO', 'MANUAL');

-- AlterTable
ALTER TABLE "Transacao" ADD COLUMN     "categoria" VARCHAR(40),
ADD COLUMN     "origemCategoria" "OrigemCategoria";

-- CreateTable
CREATE TABLE "RegraCategoria" (
    "id" TEXT NOT NULL,
    "padrao" VARCHAR(120) NOT NULL,
    "categoria" VARCHAR(40) NOT NULL,
    "tipo" "TipoTransacao",
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegraCategoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transacao_categoria_idx" ON "Transacao"("categoria");

-- RLS (ARCHITECTURE.md §5): tabela nova, sem policy.
ALTER TABLE "RegraCategoria" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "RegraCategoria" FROM anon, authenticated;
