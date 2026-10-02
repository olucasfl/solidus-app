// Seed do usuario unico (single-user). Ainda nao implementado de proposito: criar o usuario exige
// hash de senha (argon2) e o model User, que só existem a partir da spec 01-fundacao-auth.
// Ate la, este arquivo so existe para a plumbing (`pnpm db:seed`, `prisma.seed` no package.json)
// já funcionar quando a spec chegar — sem inventar o model ou a logica de auth agora.

function main(): void {
  console.log(
    'Seed pendente: entra com a spec 01-fundacao-auth (cria o usuario unico a partir de ' +
      'SEED_USER_EMAIL/SEED_USER_PASSWORD, com argon2). Nada foi escrito no banco.',
  );
}

main();
