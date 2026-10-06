-- CreateTable
CREATE TABLE "Envelope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "alocadoCentavos" INTEGER NOT NULL DEFAULT 0,
    "metaCentavos" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Envelope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Envelope_userId_idx" ON "Envelope"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_userId_nome_key" ON "Envelope"("userId", "nome");

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (ARCHITECTURE.md §5): tabela nova, sem policy. Na MESMA migration que cria a tabela (o Prisma não gera
-- RLS, e uma migration separada deixou a FonteRenda sem RLS por um instante na spec 07).
ALTER TABLE "Envelope" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "Envelope" FROM anon, authenticated;
