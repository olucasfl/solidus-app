import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// O .env fica na raiz do monorepo, nao ao lado deste arquivo nem no cwd (ARCHITECTURE.md secao 3).
// Sem isto, qualquer chamada direta (ex.: `pnpm --filter @solidus/api exec prisma migrate status`,
// sem passar pelos scripts com dotenv-cli) falha com "Environment variable not found" mesmo com o
// .env preenchido — o Prisma CLI carrega este arquivo antes de validar o schema.
loadEnv({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
});
