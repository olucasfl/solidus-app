-- CreateEnum
CREATE TYPE "TipoMovimentoCaixinha" AS ENUM ('SALDO', 'APORTE', 'RESGATE');

-- CreateEnum
CREATE TYPE "TipoImposto" AS ENUM ('IR', 'IOF');

-- CreateTable
CREATE TABLE "Caixinha" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "percentualCdiBp" INTEGER NOT NULL,
    "reservaDeGastos" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caixinha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentoCaixinha" (
    "id" TEXT NOT NULL,
    "caixinhaId" TEXT NOT NULL,
    "tipo" "TipoMovimentoCaixinha" NOT NULL,
    "data" DATE NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "dataOrigem" DATE,
    "transacaoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoCaixinha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CdiDia" (
    "data" DATE NOT NULL,
    "taxaE8" INTEGER NOT NULL,

    CONSTRAINT "CdiDia_pkey" PRIMARY KEY ("data")
);

-- CreateTable
CREATE TABLE "FaixaImposto" (
    "id" TEXT NOT NULL,
    "tipo" "TipoImposto" NOT NULL,
    "ateDias" INTEGER,
    "aliquotaBp" INTEGER NOT NULL,

    CONSTRAINT "FaixaImposto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MovimentoCaixinha_transacaoId_key" ON "MovimentoCaixinha"("transacaoId");

-- CreateIndex
CREATE INDEX "MovimentoCaixinha_caixinhaId_data_idx" ON "MovimentoCaixinha"("caixinhaId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "FaixaImposto_tipo_ateDias_key" ON "FaixaImposto"("tipo", "ateDias");

-- AddForeignKey
ALTER TABLE "MovimentoCaixinha" ADD CONSTRAINT "MovimentoCaixinha_caixinhaId_fkey" FOREIGN KEY ("caixinhaId") REFERENCES "Caixinha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoCaixinha" ADD CONSTRAINT "MovimentoCaixinha_transacaoId_fkey" FOREIGN KEY ("transacaoId") REFERENCES "Transacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (ARCHITECTURE.md §5): tabelas novas, sem policy.
ALTER TABLE "Caixinha" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "Caixinha" FROM anon, authenticated;
ALTER TABLE "MovimentoCaixinha" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "MovimentoCaixinha" FROM anon, authenticated;
ALTER TABLE "CdiDia" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CdiDia" FROM anon, authenticated;
ALTER TABLE "FaixaImposto" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "FaixaImposto" FROM anon, authenticated;
