# ARCHITECTURE.md — Solidus

Guia técnico: estrutura real do repo, convenções, fluxo de Prisma/RLS. `RULES.md` tem precedência
sobre este arquivo quando os dois parecerem dizer coisas diferentes. `docs/produto.md` tem a
visão/decisões de produto; aqui é só o "como o código está organizado".

## 1. Estado atual (vale mais que qualquer resumo — confira a data do último commit)

**Existe:** monorepo pnpm, ESLint 9 (flat) + Prettier + Husky + lint-staged + commitlint,
`apps/api` com NestJS 11 (`health` só, guard "nega por padrão", `ValidationPipe` global, filtro de
exceção, helmet, CORS, throttler básico), `packages/shared` (tipos `Centavos`/`CategoriaId`),
Prisma configurado **sem nenhum model de negócio**, Jest configurado com 1 teste de domínio e 1
e2e de `/health`. Scripts de spike do Pluggy em `apps/api/scripts/spike/`.

**Não existe:** `apps/web` (só placeholder), qualquer model Prisma, qualquer módulo além de
`health`, auth real (o guard nega tudo, não verifica token nenhum ainda), sync com o Pluggy, CI/CD,
deploy. Cada um entra com sua própria spec (`docs/specs/INDEX.md`).

## 2. Workspaces

```
apps/
  api/      @solidus/api     — NestJS 11, Prisma 6, Jest
  web/      @solidus/web     — React + Vite PWA (PENDENTE — só README.md)
packages/
  shared/   @solidus/shared  — tipos TS compartilhados, sem Node/browser/@prisma/client
```

- `pnpm-workspace.yaml` declara `apps/*` e `packages/*`.
- **Ordem de build**: `packages/shared` antes de `apps/api` (e de `apps/web`, quando existir) —
  os apps consomem `@solidus/shared/dist`, não o `src`. `pnpm dev`/`pnpm build`/`pnpm typecheck`
  já respeitam essa ordem (ver `package.json` da raiz); rodando um workspace isolado
  (`pnpm --filter @solidus/api ...`), builde o shared primeiro à mão se tiver mexido nele.
- `pnpm -r run <script>` (usado por `typecheck`/`test`/`lint` na raiz) **pula silenciosamente**
  workspaces sem aquele script — é assim que `apps/web` fica fora de tudo enquanto é só
  placeholder, sem precisar de flag `--if-present` (isso é do npm, não do pnpm).

## 3. `.env` único, na raiz

Diferente de monorepos com `.env` por app: aqui existe **um `.env` na raiz** do repo, não em
`apps/api/.env`. Duas peças precisam saber disso:

- **`ConfigModule`** (`apps/api/src/app.module.ts`): `envFilePath: ['../../.env']`, relativo a
  `apps/api` (cwd quando o pnpm roda o workspace).
- **Prisma CLI** (`prisma generate`/`migrate`/`studio`): a CLI do Prisma só carrega `.env`
  automaticamente se ele estiver ao lado do `schema.prisma` ou no cwd — nenhum dos dois é o caso
  aqui. Por isso os scripts `db:*` de `apps/api/package.json` passam por
  `dotenv-cli` (`dotenv -e ../../.env -- prisma ...`). Se adicionar um script Prisma novo, replique
  esse padrão — sem ele, a CLI roda com `DATABASE_URL`/`DIRECT_URL` vazios e falha ou (pior) trava
  esperando a conexão.
- Os scripts de spike (`apps/api/scripts/spike/*.ts`) carregam o `.env` da raiz manualmente, via
  `dotenv.config({ path: resolve(__dirname, '../../../../.env') })` (contam 4 níveis:
  `spike` → `scripts` → `api` → `apps` → raiz).

## 4. Backend (`apps/api`)

### 4.1 Estrutura

```
src/
  main.ts            — bootstrap, lê PORT do ConfigService
  app.module.ts       — monta ConfigModule/ThrottlerModule/PrismaModule/HealthModule + guards globais
  app.setup.ts         — helmet, CORS, ValidationPipe, filtro de exceção (compartilhado com testes)
  config/              — validação de env (falha rápido, nunca imprime valor)
  database/            — PrismaModule (@Global) + PrismaService
  common/
    decorators/public.decorator.ts   — @Public(), libera do guard global
    guards/access.guard.ts           — guard global: nega tudo sem @Public()
    filters/global-exception.filter.ts — nunca vaza stack trace nem corpo de request
    pipes/validation.pipe.ts          — whitelist + forbidNonWhitelisted + transform
  modules/<dominio>/    — um módulo Nest por domínio de negócio (só `health` existe hoje)
  domain/<area>/         — regra de negócio pura, sem Nest/Prisma, 100% testável (`money/` hoje)
scripts/
  spike/                — scripts manuais de exploração do Pluggy (não fazem parte do build)
  db-check-rls.ts         — falha se alguma tabela do schema public estiver sem RLS
prisma/
  schema.prisma           — datasource + generator, sem models ainda
  seed.ts                  — stub; a lógica real entra com 01-fundacao-auth
```

### 4.2 Guard global "nega por padrão"

`AccessGuard` (`common/guards/access.guard.ts`) é `APP_GUARD`: toda rota responde 401 a menos que
tenha `@Public()` no método ou na classe. **Ele não verifica token nenhum ainda** — isso é de
propósito: "seguro por padrão" não pode depender de uma verificação que não existe. A spec
`01-fundacao-auth` troca o corpo do guard para validar o access token (JWT) e a sessão; a
assinatura (`CanActivate`, `@Public()`) já fica pronta.

`ThrottlerGuard` (`@nestjs/throttler`) também é `APP_GUARD`, registrado depois — os dois guards
globais rodam em cadeia; qualquer um que rejeitar encerra a request.

### 4.3 `GET /health`

Único endpoint `@Public()` hoje. Checa o banco com `SELECT 1` (`PrismaService.isHealthy()`) e
devolve `{ status, timestamp, database }` — nunca versão ou detalhe interno. Usado por
monitoramento e, futuramente, pelo cron externo antes de chamar `POST /sync`.

### 4.4 Módulo novo (quando a primeira spec chegar)

Um módulo por domínio em `apps/api/src/modules/<dominio>/`, registrado em `app.module.ts`. DTO
com `class-validator` em toda rota que aceita body/query (o `ValidationPipe` global é
`whitelist + forbidNonWhitelisted` — campo sem decorator não existe para a API). Regra de negócio
com cálculo vai em `domain/`, não no service do módulo.

### 4.5 Erros

`GlobalExceptionFilter` (`common/filters/`) intercepta tudo: `HttpException` mantém seu
status/corpo; qualquer outro erro vira 500 genérico (`{ statusCode, message: "Erro interno" }`), e
o detalhe real só vai para o log do servidor (nunca para a resposta, nunca com corpo de request ou
segredo no log).

## 5. Prisma e RLS

- `schema.prisma`: `datasource db` usa `DATABASE_URL` (pooler de transação, runtime) e
  `directUrl` com `DIRECT_URL` (pooler de sessão, só para `migrate`). O Prisma conecta como role
  `postgres` — RLS não afeta as queries da API; existe para fechar a Data API do Supabase (não
  usada) e qualquer acesso futuro por `anon`/`authenticated`.
- **Toda migration que cria tabela** termina, para aquela tabela:
  ```sql
  ALTER TABLE "NomeDaTabela" ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON "NomeDaTabela" FROM anon, authenticated;
  ```
  Sem policy nenhuma — a tabela fica inacessível para essas duas roles, ponto.
- `pnpm db:check-rls` (`apps/api/scripts/db-check-rls.ts`) consulta `pg_class`/
  `information_schema.role_table_grants` e falha se achar tabela sem RLS ou grant residual. Rode
  depois de toda migration nova, antes de considerá-la pronta (`/db-change` já inclui o passo).
- Fluxo local: editar `schema.prisma` → `pnpm db:migrate` (gera o diretório em
  `prisma/migrations/`, que precisa ser commitado) → revisar o SQL gerado → `pnpm db:check-rls` →
  `pnpm db:generate` se precisar regenerar o client sem nova migration.
- Banco é o Supabase do projeto, **remoto e compartilhado por padrão** — nunca rode migration
  destrutiva sem confirmar (`RULES.md` §6).

## 6. `packages/shared`

Só tipos/contratos, sem lógica e sem nada específico de Node ou browser (`window`, `fs`,
`@prisma/client` ficam de fora). Hoje: `Centavos` (alias de `number`, inteiro) e `CategoriaId`
(alias de `string` — a taxonomia real de categorias é decisão da spec `03-categorizacao`, não
antecipada aqui). Cresce conforme `apps/web` precisar do mesmo shape que `apps/api` expõe.

## 7. Variáveis de ambiente

Validadas no boot por `apps/api/src/config/env.validation.ts` — falha rápido, mensagem lista só o
nome da variável com problema, nunca o valor. Lista completa (com comentário do propósito de cada
uma) em `.env.example`, na raiz.

## 8. O que falta documentar aqui

Esta seção existe para não fingir completude: quando a spec `01-fundacao-auth` entrar, este
arquivo ganha uma seção de módulos de negócio reais (§4.4 deixa de ser "quando a primeira spec
chegar"), e uma seção de modelos Prisma deixa de estar vazia. Até lá, não assuma nenhum dos dois
como implícito.
