-- CreateEnum
CREATE TYPE "TipoFonteRenda" AS ENUM ('SALARIO', 'RECORRENTE');

-- CreateEnum
CREATE TYPE "OrigemFonteRenda" AS ENUM ('MANUAL', 'AUTOMATICA');

-- AlterEnum
ALTER TYPE "OrigemCategoria" ADD VALUE 'FONTE_RENDA';

-- AlterTable
ALTER TABLE "Transacao" ADD COLUMN     "contraparteChave" VARCHAR(64),
ADD COLUMN     "contraparteDocMascarado" VARCHAR(20),
ADD COLUMN     "contraparteNome" VARCHAR(200);

-- CreateTable
CREATE TABLE "FonteRenda" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" "TipoFonteRenda" NOT NULL,
    "origem" "OrigemFonteRenda" NOT NULL,
    "contraparteChave" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(200),
    "docMascarado" VARCHAR(20),
    "vigenteDesde" TIMESTAMP(3) NOT NULL,
    "vigenteAte" TIMESTAMP(3),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FonteRenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FonteRenda_userId_contraparteChave_idx" ON "FonteRenda"("userId", "contraparteChave");

-- CreateIndex
CREATE INDEX "Transacao_userId_contraparteChave_idx" ON "Transacao"("userId", "contraparteChave");

-- AddForeignKey
ALTER TABLE "FonteRenda" ADD CONSTRAINT "FonteRenda_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
