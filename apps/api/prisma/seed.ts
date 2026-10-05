// Seed do usuário único (single-user, spec 01-fundacao-auth). Idempotente: roda de novo e
// atualiza o hash a partir do SEED_USER_PASSWORD atual, sem duplicar o usuário (upsert por e-mail)
// — é também o jeito de "trocar a senha" sem rota de reset (ver spec, "Fora de escopo").
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import * as argon2 from 'argon2';
import { PrismaClient, type TipoImposto } from '@prisma/client';
import { IOF_PADRAO, IR_PADRAO } from '../src/domain/carteira/impostos-padrao';

loadEnv({ path: resolve(__dirname, '../../../.env') });

function seedEmail(): string {
  const email = process.env.SEED_USER_EMAIL;
  if (!email) {
    throw new Error('SEED_USER_EMAIL ausente — preencha o .env antes de rodar o seed.');
  }
  return email;
}

function seedSenha(): string {
  const senha = process.env.SEED_USER_PASSWORD;
  if (!senha) {
    throw new Error('SEED_USER_PASSWORD ausente — preencha o .env antes de rodar o seed.');
  }
  return senha;
}

/** Semeia IR/IOF só se a tabela do tipo estiver vazia: o que o usuário editou nunca é sobrescrito. */
async function semearImpostos(prisma: PrismaClient): Promise<void> {
  const tabelas: Array<[TipoImposto, typeof IR_PADRAO]> = [
    ['IR', IR_PADRAO],
    ['IOF', IOF_PADRAO],
  ];
  for (const [tipo, faixas] of tabelas) {
    if ((await prisma.faixaImposto.count({ where: { tipo } })) > 0) {
      console.log(`Imposto ${tipo}: tabela já existe, mantida.`);
      continue;
    }
    await prisma.faixaImposto.createMany({
      data: faixas.map((f) => ({ tipo, ateDias: f.ateDias, aliquotaBp: f.aliquotaBp })),
    });
    console.log(`Imposto ${tipo}: ${faixas.length} faixas semeadas (confira em GET /impostos).`);
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const email = seedEmail();
    const senhaHash = await argon2.hash(seedSenha());

    const usuario = await prisma.user.upsert({
      where: { email },
      create: { email, senhaHash, papel: 'ADMIN' },
      update: { senhaHash, papel: 'ADMIN' },
    });

    console.log(`Seed ok — usuário único: ${usuario.email} (id ${usuario.id}).`);
    await semearImpostos(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Falha ao rodar o seed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
