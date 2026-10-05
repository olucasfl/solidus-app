-- RLS (ARCHITECTURE.md §5): tabela nova, sem policy. A migration anterior (salario_e_pix_automatico) criou a
-- FonteRenda; o Prisma não gera RLS, então este passo vem separado. Quem aplicar os dois em sequência obtém
-- a tabela já fechada para anon/authenticated.
ALTER TABLE "FonteRenda" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "FonteRenda" FROM anon, authenticated;
