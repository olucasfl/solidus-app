-- CreateEnum
CREATE TYPE "PapelUsuario" AS ENUM ('USUARIO', 'ADMIN');

-- AlterTable
ALTER TABLE "Caixinha" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Conta" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "MovimentoCaixinha" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "RegraCategoria" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Transacao" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "papel" "PapelUsuario";

-- CreateIndex
CREATE INDEX "Caixinha_userId_idx" ON "Caixinha"("userId");

-- CreateIndex
CREATE INDEX "Conta_userId_idx" ON "Conta"("userId");

-- CreateIndex
CREATE INDEX "MovimentoCaixinha_userId_idx" ON "MovimentoCaixinha"("userId");

-- CreateIndex
CREATE INDEX "RegraCategoria_userId_idx" ON "RegraCategoria"("userId");

-- CreateIndex
CREATE INDEX "SyncRun_userId_iniciadoEm_idx" ON "SyncRun"("userId", "iniciadoEm");

-- CreateIndex
CREATE INDEX "Transacao_userId_data_idx" ON "Transacao"("userId", "data");

-- AddForeignKey
ALTER TABLE "Conta" ADD CONSTRAINT "Conta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transacao" ADD CONSTRAINT "Transacao_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegraCategoria" ADD CONSTRAINT "RegraCategoria_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caixinha" ADD CONSTRAINT "Caixinha_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoCaixinha" ADD CONSTRAINT "MovimentoCaixinha_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (spec 06, etapa 1): até aqui só existia UM usuário (o do seed); todo dado existente é dele.
-- Em banco sem usuário a subconsulta é NULL e nada muda. O primeiro usuário também vira ADMIN.
UPDATE "User" SET "papel" = 'ADMIN'
  WHERE "id" = (SELECT "id" FROM "User" ORDER BY "criadoEm" ASC LIMIT 1) AND "papel" IS NULL;
UPDATE "Conta" SET "userId" = (SELECT "id" FROM "User" ORDER BY "criadoEm" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "Transacao" SET "userId" = (SELECT "id" FROM "User" ORDER BY "criadoEm" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "SyncRun" SET "userId" = (SELECT "id" FROM "User" ORDER BY "criadoEm" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "RegraCategoria" SET "userId" = (SELECT "id" FROM "User" ORDER BY "criadoEm" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "Caixinha" SET "userId" = (SELECT "id" FROM "User" ORDER BY "criadoEm" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "MovimentoCaixinha" SET "userId" = (SELECT "id" FROM "User" ORDER BY "criadoEm" ASC LIMIT 1) WHERE "userId" IS NULL;
