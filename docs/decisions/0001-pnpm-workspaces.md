# 0001 — pnpm workspaces

**Status:** aceita · 2026-10-02

## Contexto

Monorepo com `apps/api`, `apps/web` (pendente) e `packages/shared`. Precisa de um gerenciador de
workspaces que resolva dependências entre os packages locais e evite duplicar `node_modules`.

## Decisão

pnpm workspaces (`pnpm-workspace.yaml`), não npm workspaces nem Yarn.

## Motivo

- Content-addressable store evita duplicação de dependências entre `apps/api` e
  `packages/shared`.
- `pnpm -r run <script>` pula silenciosamente workspace sem aquele script — convenção usada para
  manter `apps/web` fora de `build`/`test`/`lint`/`typecheck` enquanto é só placeholder, sem
  precisar de flag equivalente ao `--if-present` do npm.
- pnpm 10+ bloqueia scripts de instalação (`postinstall`) de dependências não listadas em
  `onlyBuiltDependencies` por padrão — mais seguro contra supply-chain, exige listar explicitamente
  quem precisa rodar build script (`esbuild`, `prisma`, `@prisma/client`, `@nestjs/core`).

## Consequência

Qualquer comando do dia a dia usa `pnpm`/`pnpm --filter`, nunca `npm`/`npx` dentro do repo.
