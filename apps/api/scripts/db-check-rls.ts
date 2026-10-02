// Falha (exit 1) se alguma tabela do schema public estiver sem RLS, ou com grant para
// anon/authenticated (ARCHITECTURE.md). Roda fora do Nest: script de infra, nao teste — instanciar
// PrismaClient aqui direto é esperado (RULES.md so proibe isso em teste).
import { PrismaClient } from '@prisma/client';

interface TabelaSemRls {
  tablename: string;
}

interface GrantIndevido {
  table_name: string;
  grantee: string;
  privilege_type: string;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const semRls = await prisma.$queryRaw<TabelaSemRls[]>`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false
      ORDER BY c.relname
    `;

    const grants = await prisma.$queryRaw<GrantIndevido[]>`
      SELECT table_name, grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
      ORDER BY table_name, grantee
    `;

    if (semRls.length === 0 && grants.length === 0) {
      console.log(
        'db:check-rls ok — nenhuma tabela do schema public sem RLS, nenhum grant residual.',
      );
      return;
    }

    if (semRls.length > 0) {
      console.error('Tabelas SEM RLS habilitado:');
      for (const t of semRls) {
        console.error(`  - ${t.tablename}`);
      }
    }
    if (grants.length > 0) {
      console.error('Grants indevidos para anon/authenticated:');
      for (const g of grants) {
        console.error(`  - ${g.table_name}: ${g.privilege_type} para ${g.grantee}`);
      }
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Falha ao verificar RLS:', error instanceof Error ? error.message : error);
  process.exit(1);
});
