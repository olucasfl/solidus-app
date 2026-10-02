-- CreateEnum
CREATE TYPE "ClienteSessao" AS ENUM ('WEB', 'PWA');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "senhaHash" VARCHAR(255) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cliente" "ClienteSessao" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_idx" ON "RefreshSession"("userId");

-- CreateIndex
CREATE INDEX "RefreshSession_tokenHash_idx" ON "RefreshSession"("tokenHash");

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (ARCHITECTURE.md §5): o Prisma conecta como role postgres e ignora RLS; isto só fecha a
-- Data API do Supabase e qualquer acesso futuro por anon/authenticated. Sem policy nenhuma.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "User" FROM anon, authenticated;
ALTER TABLE "RefreshSession" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "RefreshSession" FROM anon, authenticated;

-- Esta é a primeira migration do projeto: "_prisma_migrations" (tabela interna do Prisma Migrate,
-- não vem do schema.prisma) nasceu agora, com os grants padrão do Supabase para anon/authenticated
-- no schema public. pnpm db:check-rls olha toda tabela do schema public, não só as do schema.prisma
-- — sem isto ela fica sem RLS e com grant residual pra sempre, igual qualquer outra tabela.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "_prisma_migrations" FROM anon, authenticated;
