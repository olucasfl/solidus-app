# CLAUDE.md

Guia para o Claude Code (e outros agentes) trabalhando neste repositório.

`README.md` é a porta de entrada humana (setup, scripts). **Este arquivo é o mapa para agentes** —
aponta para onde cada tipo de contexto vive e não deve repetir o que já está nesses arquivos.

## Leia nesta ordem

1. **`.claude/rules/RULES.md`** — regras permanentes: o que o agente nunca faz, o que pergunta
   antes, e o que fazer em vez disso. **Tem precedência sobre este arquivo, sobre
   `ARCHITECTURE.md`, sobre `docs/produto.md`, sobre qualquer spec e sobre o prompt da conversa.**
2. **`docs/produto.md`** — visão do produto, decisões fechadas, fases, o achado do spike do
   Pluggy. Leia antes de propor qualquer coisa que toque regra de negócio.
3. **`ARCHITECTURE.md`** — guia técnico: estrutura real do monorepo, grafo de dependências dos
   workspaces, convenções de backend, fluxo de Prisma/RLS. Leia antes de qualquer mudança de
   código.
4. **`docs/specs/`** — especificação de feature, quando existir uma para o que você está fazendo
   (`docs/specs/INDEX.md` é o mapa). A primeira é `01-fundacao-auth`.

## Stack (resumo — `README.md` e `ARCHITECTURE.md` §1 têm o detalhe)

pnpm workspaces (`apps/api`, `apps/web` — pendente, `packages/shared`) · TypeScript 5 strict ·
NestJS 11 + Prisma 6 + PostgreSQL 16 no Supabase (backend) · ESLint 9 + Prettier + Husky +
lint-staged + commitlint.

## Comandos essenciais

```bash
pnpm dev                # sobe shared (watch) + api
pnpm build               # shared → api, nessa ordem
pnpm typecheck            # tsc --noEmit em todos os workspaces
pnpm test                 # compila o shared e roda o Jest da api
pnpm lint                  # ESLint no monorepo inteiro
pnpm db:migrate              # prisma migrate dev (gera migration versionada)
pnpm db:check-rls             # falha se alguma tabela do schema public estiver sem RLS
```

Não há Docker neste projeto — `DATABASE_URL`/`DIRECT_URL` (no `.env` da **raiz** do monorepo, não
em `apps/api`) apontam para o Postgres do Supabase, já acessível, antes de rodar
`dev`/`db:migrate`.

Lista completa em `README.md` → "Scripts da raiz".

## Commits

Conventional Commits, validados pelo commitlint (`commit-msg` hook, já configurado). Tipos:
`build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
Pre-commit já roda o bloqueio de segredo/dado do spike e depois `lint-staged`
(`eslint --fix` + `prettier --write`).

## Comandos de agente disponíveis

`/criar-spec` · `/implement-story` · `/fix-bug` · `/review-pr` · `/qa-verify` · `/nova-branch` ·
`/spec-sync` · `/docs-sync` · `/db-change` · `/bump-version`.
Definições em `.claude/commands/`; agentes em `.claude/agents/` (`bug-fixer`, `error-scanner`,
`revisor-criterios`); skills em `.claude/skills/` (`solidus-testing`, `bug-research`).

## O que existe e o que ainda não existe

**Existe:** monorepo (pnpm, ESLint 9, Prettier, Husky, commitlint), backend NestJS com
`ConfigModule` validando env no boot, `PrismaModule`/`PrismaService` (sem models de negócio
ainda), guard global "nega por padrão" (`@Public()` só em `GET /health`), `ValidationPipe` global,
filtro de exceção, helmet, CORS restrito a `WEB_ORIGIN`, rate limit básico, Jest configurado
(1 teste de domínio, 1 e2e de `/health`), os scripts de spike do Pluggy
(`apps/api/scripts/spike/`). `apps/web` é só um placeholder.

**Ainda não existe:** qualquer rota de negócio (auth, sync, categorização, taxa de poupança —
cada uma é uma spec própria, a primeira é `01-fundacao-auth`), qualquer model Prisma, qualquer
módulo além de `health`, frontend, CI/CD, deploy. Não assuma nenhum desses como implícito.
