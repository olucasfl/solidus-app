# Solidus

App pessoal de finanças (single-user, somente leitura). Visão e decisões de produto em
[`docs/produto.md`](docs/produto.md); mapa para agentes em [`CLAUDE.md`](CLAUDE.md); guia técnico
em [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Setup

Requisitos: Node ≥ 20, pnpm 12.8.1 (`packageManager` já fixa a versão).

```bash
pnpm install
cp .env.example .env   # preencha os valores — nunca commite o .env
pnpm db:generate
pnpm dev
```

O `.env` fica na **raiz** do monorepo (não em `apps/api`) — ver `ARCHITECTURE.md` §3 para por
quê. Não há Docker: `DATABASE_URL`/`DIRECT_URL` apontam para o Postgres do Supabase do projeto,
já acessível antes de rodar `dev`/`db:migrate`.

## Scripts da raiz

| Script                         | O que faz                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `pnpm dev`                     | sobe `packages/shared` em watch + a API NestJS                                                      |
| `pnpm build`                   | builda `packages/shared`, depois `apps/api`                                                         |
| `pnpm typecheck`               | `tsc --noEmit` em todos os workspaces (builda o shared antes)                                       |
| `pnpm test`                    | builda o shared e roda o Jest da API                                                                |
| `pnpm lint` / `lint:fix`       | ESLint no monorepo inteiro                                                                          |
| `pnpm format` / `format:check` | Prettier no monorepo inteiro                                                                        |
| `pnpm db:generate`             | `prisma generate` (lê o `.env` da raiz via `dotenv-cli`)                                            |
| `pnpm db:migrate`              | `prisma migrate dev` — gera migration versionada                                                    |
| `pnpm db:deploy`               | `prisma migrate deploy` — aplica migrations pendentes sem gerar nova                                |
| `pnpm db:seed`                 | cria/atualiza o usuário único a partir de `SEED_USER_*` (idempotente; é também como trocar a senha) |
| `pnpm db:check-rls`            | falha se alguma tabela do schema `public` estiver sem RLS, ou com grant para `anon`/`authenticated` |
| `pnpm db:studio`               | abre o Prisma Studio                                                                                |

## Rotas da API (Fase 1)

Tudo exige `Authorization: Bearer <accessToken>`, exceto `GET /health`, `POST /auth/login`,
`POST /auth/refresh` e `POST /sync` (esta usa o header `x-sync-token`). Detalhe e erros em cada spec.

| Rota                                                                                          | O que faz                                       | Spec |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---- |
| `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`                           | sessão do usuário único                         | 01   |
| `POST /sync`, `GET /sync/status`                                                              | puxa contas e transações do Pluggy (só leitura) | 02   |
| `GET /categorias`, `GET/POST /regras`, `DELETE /regras/:id`, `POST /categorizacao/recalcular` | categorização por regras                        | 03   |
| `GET /transacoes`, `PATCH /transacoes/:id/categoria`                                          | listar e corrigir categoria                     | 03   |
| `GET /poupanca?mes=YYYY-MM`, `GET /poupanca/historico?meses=N`                                | taxa de poupança                                | 04   |

Para rodar contra o Pluggy de verdade: suba a API (`pnpm dev`), faça login, e chame
`POST /sync` com o `SYNC_CRON_TOKEN` do `.env`.

## Como rodar o spike do Pluggy

Scripts manuais de exploração, em `apps/api/scripts/spike/` — não fazem parte do build nem do
fluxo normal da API:

```bash
pnpm spike:connect   # abre http://localhost:4310, você autoriza o conector MeuPluggy,
                      # o script grava PLUGGY_ITEM_ID no .env e encerra
pnpm spike:dump       # lê item, contas, transações e investimentos; salva o JSON cru em
                      # spike-output/ (gitignored — dados reais da conta) e imprime um resumo
```

Achados do último spike (incluindo por que investimentos não batem com o Nubank) estão em
`docs/produto.md`.

## `.env`

Todas as variáveis, com comentário do que cada uma é, em [`.env.example`](.env.example). Nunca
preencha valor real ali — só no `.env` local, que é gitignored e bloqueado por hook de pre-commit
caso alguém tente forçar o stage.

## Estrutura

```
apps/
  api/      NestJS 11 + Prisma 6 — único backend hoje
  web/      React + Vite PWA — pendente, começa depois do backend
packages/
  shared/   contratos TypeScript compartilhados (auth, sync, categorias, poupança)
docs/
  produto.md         visão, decisões fechadas, achado do spike
  decisions/          um ADR por decisão de arquitetura
  specs/               spec por feature + INDEX.md (status)
```
