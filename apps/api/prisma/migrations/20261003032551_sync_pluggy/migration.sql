-- CreateEnum
CREATE TYPE "TipoConta" AS ENUM ('CORRENTE', 'POUPANCA', 'CARTAO');

-- CreateEnum
CREATE TYPE "TipoTransacao" AS ENUM ('DEBITO', 'CREDITO');

-- CreateEnum
CREATE TYPE "StatusTransacao" AS ENUM ('PENDENTE', 'EFETIVADA');

-- CreateEnum
CREATE TYPE "StatusSync" AS ENUM ('SUCESSO', 'FALHA');

-- CreateTable
CREATE TABLE "Conta" (
    "id" TEXT NOT NULL,
    "pluggyAccountId" TEXT NOT NULL,
    "tipo" "TipoConta" NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "saldoCentavos" INTEGER NOT NULL,
    "moeda" VARCHAR(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transacao" (
    "id" TEXT NOT NULL,
    "pluggyTransactionId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "descricao" VARCHAR(500) NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "tipo" "TipoTransacao" NOT NULL,
    "status" "StatusTransacao" NOT NULL,
    "moeda" VARCHAR(3) NOT NULL,
    "categoriaPluggy" VARCHAR(120),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoEm" TIMESTAMP(3),
    "status" "StatusSync" NOT NULL,
    "contas" INTEGER NOT NULL DEFAULT 0,
    "transacoesNovas" INTEGER NOT NULL DEFAULT 0,
    "transacoesAtualizadas" INTEGER NOT NULL DEFAULT 0,
    "erro" VARCHAR(60),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conta_pluggyAccountId_key" ON "Conta"("pluggyAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Transacao_pluggyTransactionId_key" ON "Transacao"("pluggyTransactionId");

-- CreateIndex
CREATE INDEX "Transacao_contaId_data_idx" ON "Transacao"("contaId", "data");

-- CreateIndex
CREATE INDEX "Transacao_data_idx" ON "Transacao"("data");

-- AddForeignKey
ALTER TABLE "Transacao" ADD CONSTRAINT "Transacao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (ARCHITECTURE.md §5): sem policy; fecha a Data API do Supabase para anon/authenticated.
ALTER TABLE "Conta" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "Conta" FROM anon, authenticated;
ALTER TABLE "Transacao" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "Transacao" FROM anon, authenticated;
ALTER TABLE "SyncRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "SyncRun" FROM anon, authenticated;
