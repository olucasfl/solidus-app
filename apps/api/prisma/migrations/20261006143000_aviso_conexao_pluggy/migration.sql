-- CreateTable
CREATE TABLE "ConexaoPluggy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" VARCHAR(64) NOT NULL,
    "statusItem" VARCHAR(40),
    "statusExecucao" VARCHAR(40),
    "consentimentoExpiraEm" TIMESTAMP(3),
    "ultimaAtualizacaoEm" TIMESTAMP(3),
    "proximaAtualizacaoEm" TIMESTAMP(3),
    "autoSyncDesativadoEm" TIMESTAMP(3),
    "falhasDeLogin" INTEGER,
    "acaoPendente" BOOLEAN NOT NULL DEFAULT false,
    "verificadoEm" TIMESTAMP(3),
    "erroVerificacao" VARCHAR(60),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConexaoPluggy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConexaoPluggy_userId_key" ON "ConexaoPluggy"("userId");

-- AddForeignKey
ALTER TABLE "ConexaoPluggy" ADD CONSTRAINT "ConexaoPluggy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (ARCHITECTURE.md §5): tabela nova, sem policy. Na MESMA migration que cria a tabela: o Prisma não
-- gera RLS, e uma migration separada deixou a FonteRenda sem RLS por um instante na spec 07.
ALTER TABLE "ConexaoPluggy" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConexaoPluggy" FROM anon, authenticated;
