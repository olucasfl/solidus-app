-- CreateEnum
CREATE TYPE "BaseGastoReserva" AS ENUM ('BRUTA', 'LIQUIDA');

-- AlterTable
ALTER TABLE "Caixinha" ADD COLUMN     "reservaEmergencia" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConfiguracaoReserva" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "meses" INTEGER NOT NULL DEFAULT 6,
    "base" "BaseGastoReserva" NOT NULL DEFAULT 'BRUTA',
    "janelaMeses" INTEGER NOT NULL DEFAULT 6,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoReserva_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracaoReserva_userId_key" ON "ConfiguracaoReserva"("userId");

-- AddForeignKey
ALTER TABLE "ConfiguracaoReserva" ADD CONSTRAINT "ConfiguracaoReserva_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (ARCHITECTURE.md §5): tabela nova, sem policy. Na MESMA migration que cria a tabela (o Prisma não gera
-- RLS, e uma migration separada deixou a FonteRenda sem RLS por um instante na spec 07).
ALTER TABLE "ConfiguracaoReserva" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConfiguracaoReserva" FROM anon, authenticated;
