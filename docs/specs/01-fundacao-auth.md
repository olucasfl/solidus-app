# Spec: Fundação e autenticação

> Status: em andamento (2026-10-02) — implementação, typecheck, lint, testes e build verdes;
> falta corrigir `SEED_USER_PASSWORD` no `.env` (menos de 8 caracteres, bloqueia o boot real da
> API) e a conferência manual do cookie no DevTools antes de considerar implementada
> (`docs/specs/INDEX.md`).

## Objetivo

Deixar o Lucas entrar no Solidus com o usuário único criado pelo seed (e-mail + senha) e manter a
sessão ativa sem relogar toda hora — hoje o `AccessGuard` nega qualquer rota, mesmo com credenciais
certas, porque não existe verificação de token nenhuma.

## Stack

Padrão da casa, com três dependências novas em `apps/api` (exigem aprovação explícita antes da
implementação, `RULES.md` §12):

- **`argon2`** — hash da senha do seed e verificação no login (já decidido em `docs/produto.md`).
- **`@nestjs/jwt`** (ou `jsonwebtoken` direto — a implementação decide) — assina/verifica o access
  token (HS256, `JWT_ACCESS_SECRET`) e o refresh token (HS256, `JWT_REFRESH_SECRET`), ambos já
  validados em `env.validation.ts`.
- **`cookie-parser`** — lê o cookie do refresh token em `POST /auth/refresh` e `POST /auth/logout`.

Nenhuma delas entra em `packages/shared` (são detalhe de backend).

## Comportamento esperado

- **Login** (`POST /auth/login`, `@Public()`) com o e-mail/senha do seed → access token (JWT, 15
  min) no corpo da resposta + refresh token em cookie `httpOnly`. Senha errada ou e-mail que não é
  o do seed → **o mesmo erro genérico** (`AUTH_CREDENCIAIS_INVALIDAS`), pra não revelar qual dos
  dois está errado (só existe um usuário, mas o princípio vale igual).
- **Duas TTLs de refresh, por tipo de cliente**, informado no próprio login (campo `cliente`,
  default `"web"` se ausente):
  - `cliente: "web"` → refresh expira em **7 dias**.
  - `cliente: "pwa"` → refresh **não expira por tempo** (`expiraEm: null` no banco). O app PWA
    instalado no celular não desloga por TTL — só é deslogado se a sessão for revogada (logout
    explícito, reuso de token detectado, ou limpeza manual direto no banco numa manutenção/
    atualização; não existe rota de "revogar tudo" nesta spec, ver "Fora de escopo").
  - O frontend decide o valor de `cliente` com `window.matchMedia('(display-mode: standalone)')`
    (ou equivalente) antes de chamar `/auth/login` — isso é trabalho da spec que criar `apps/web`,
    não desta; aqui só o contrato da API é definido.
- **Múltiplas sessões simultâneas**: cada login cria uma `RefreshSession` própria (não derruba
  sessões de outros dispositivos). `POST /auth/logout` revoga **só a sessão do cookie atual**.
- **Refresh rotation**: `POST /auth/refresh` (`@Public()`, lê o cookie) emite um access token novo
  **e** substitui a sessão — marca a `RefreshSession` atual como revogada e cria uma nova, com o
  mesmo `cliente` (e portanto a mesma regra de TTL) da sessão anterior. Reusar um refresh já
  revogado (token roubado e usado depois do dono já ter rotacionado) é erro: `AUTH_SESSAO_INVALIDA`.
- **Access token é stateless**: o `AccessGuard` verifica só assinatura + expiração do JWT (sem
  consultar o banco a cada request). Só o refresh — por ser de vida mais longa — é validado contra
  a `RefreshSession` no banco (hash do token, `revogadoEm`, `expiraEm`).
- **Token em claro nunca é gravado**: a tabela guarda só o hash SHA-256 (hex, 64 caracteres) do
  refresh token. O token puro só existe no cookie do cliente.
- **Limite de tentativas de login**: 5 por minuto por IP (`@nestjs/throttler`, mesmo mecanismo já
  configurado globalmente, sobrescrito nessa rota). A 6ª tentativa no mesmo minuto é 429.
- **`GET /auth/me`** (autenticado) devolve `{ id, email }` do usuário do access token — forma de
  o frontend confirmar a sessão sem decodificar o JWT.
- **Seed idempotente**: `prisma/seed.ts` faz upsert do usuário único a partir de
  `SEED_USER_EMAIL`/`SEED_USER_PASSWORD` (hash argon2) — rodar o seed duas vezes não duplica nem
  falha.
- **Registro continua fechado**: não existe `POST /auth/registro` nem qualquer outra forma de criar
  usuário pela API. O único jeito de ter uma conta é o seed.

## Requisitos de saída

Prefixo assumido: sem prefixo global ainda (`main.ts` não define um hoje) — todas as rotas abaixo
são relativas à raiz (`POST /auth/login`, etc.), igual a `GET /health` hoje.

| Rota                 | `@Public()` | Corpo                                                        | Sucesso                                                                  | Erros                                                                        |
| -------------------- | ----------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `POST /auth/login`   | sim         | `{ email: string, senha: string, cliente?: 'web' \| 'pwa' }` | **200** `{ accessToken: string, usuario: { id, email } }` + `Set-Cookie` | 400 `VALIDACAO` · 401 `AUTH_CREDENCIAIS_INVALIDAS` · 429 `LIMITE_TENTATIVAS` |
| `POST /auth/refresh` | sim         | nenhum (lê o cookie)                                         | **200** `{ accessToken: string }` + `Set-Cookie` novo (rotação)          | 401 `AUTH_SESSAO_INVALIDA` (cookie ausente, inválido, revogado ou vencido)   |
| `POST /auth/logout`  | não         | nenhum (lê o cookie + o access token do header)              | **204**, `Set-Cookie` limpo (`Max-Age=0`)                                | 401 (herdado do guard global, access token ausente/inválido)                 |
| `GET /auth/me`       | não         | nenhum                                                       | **200** `{ id: string, email: string }`                                  | 401 (herdado do guard global)                                                |

Cookie do refresh: nome `solidus_refresh`, `httpOnly`, `sameSite: 'lax'`, `secure` só quando
`NODE_ENV=production`, `path: '/'`. Ajuste fino pra topologia cross-site (se `apps/web` e a API
ficarem em domínios diferentes em produção) é decisão da spec/deploy que colocar `apps/web` no ar —
sinalizado em "Fora de escopo".

Código de validação (`fields`) segue o padrão de erro já usado por `GlobalExceptionFilter`: 400
lista o campo problemático (`email` ou `senha`).

## Modelo de dados

**Aditivo** — dois models novos, nenhuma tabela existente pra alterar.

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique @db.VarChar(254)
  senhaHash    String   @db.VarChar(255)
  criadoEm     DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  sessoes RefreshSession[]
}

enum ClienteSessao {
  WEB
  PWA
}

// Token em claro NUNCA é gravado — só o hash SHA-256 (hex, 64 chars), igual a qualquer outro
// segredo de uso único do projeto. expiraEm null = sessão PWA, sem TTL (ver "Comportamento esperado").
model RefreshSession {
  id         String        @id @default(uuid())
  userId     String
  user       User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  cliente    ClienteSessao
  tokenHash  String        @db.Char(64)
  criadoEm   DateTime      @default(now())
  expiraEm   DateTime?
  revogadoEm DateTime?

  @@index([userId])
  @@index([tokenHash])
}
```

Migration termina, para as duas tabelas:

```sql
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "User" FROM anon, authenticated;
ALTER TABLE "RefreshSession" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "RefreshSession" FROM anon, authenticated;
```

`pnpm db:check-rls` precisa passar antes de considerar a migration pronta (`/db-change`).

## Contrato compartilhado

`apps/web` ainda não existe, mas o contrato de auth é a base de tudo que vem depois — entra em
`packages/shared/src/auth.ts` desde já, pro dia em que o web chegar consumir sem duplicar o shape:

```ts
export type ClienteSessao = 'web' | 'pwa';

export interface LoginRequest {
  email: string;
  senha: string;
  cliente?: ClienteSessao;
}

export interface Usuario {
  id: string;
  email: string;
}

export interface LoginResponse {
  accessToken: string;
  usuario: Usuario;
}

export interface RefreshResponse {
  accessToken: string;
}

export type AuthErrorCode = 'AUTH_CREDENCIAIS_INVALIDAS' | 'AUTH_SESSAO_INVALIDA';
```

## Regra de negócio e dinheiro

n/a — esta spec não lê nem calcula valor monetário.

## Critérios de aceite (testáveis, em BDD)

`curl` contra a API local; `SEED_USER_EMAIL=lucas@exemplo.com` / `SEED_USER_PASSWORD=senha-forte-123`
nos testes (`RULES.md` §8 — nunca a senha real).

- [x] **CA-01** — **Dado** o seed rodado, **quando** `POST /auth/login` com e-mail e senha certos
      (sem o campo `cliente`), **então** 200 com `accessToken` e `usuario: { id, email }`; existe
      `Set-Cookie: solidus_refresh=...; HttpOnly`; no banco, há uma `RefreshSession`
      (`cliente: WEB`) com `expiraEm` ≈ 7 dias à frente e `tokenHash` de 64 hex.
- [x] **CA-02** — **Dado** o mesmo usuário, **quando** `POST /auth/login` com `cliente: "pwa"`,
      **então** 200 igual ao CA-01, mas a `RefreshSession` criada tem `cliente: PWA` e
      `expiraEm: null`.
- [x] **CA-03** — **Dado** o seed rodado, **quando** faço login com a senha ERRADA, **então** 401
      `AUTH_CREDENCIAIS_INVALIDAS`, sem `Set-Cookie`, nenhuma `RefreshSession` criada.
- [x] **CA-04** — **Dado** um e-mail que não é o do seed, **quando** faço login com ele (senha
      qualquer), **então** 401 `AUTH_CREDENCIAIS_INVALIDAS` — **o mesmo corpo** do CA-03.
- [x] **CA-05** — **Dado** `POST /auth/login` com `email` que não é e-mail válido, ou `senha`
      vazia, **então** 400 `VALIDACAO` com `fields` apontando o campo errado.
- [x] **CA-06** — **Dado** o cookie do CA-01, **quando** `POST /auth/refresh`, **então** 200 com
      `accessToken` novo e `Set-Cookie` novo (token diferente do CA-01); no banco, a
      `RefreshSession` do CA-01 tem `revogadoEm` preenchido e existe uma nova, `cliente: WEB`
      (herdado), `revogadoEm: null`.
- [x] **CA-07** — **Dado** nenhum cookie, **quando** `POST /auth/refresh`, **então** 401
      `AUTH_SESSAO_INVALIDA`.
- [x] **CA-08** — **Dado** o cookie do CA-01 (já revogado pelo CA-06, reuso), **quando**
      `POST /auth/refresh` com ele de novo, **então** 401 `AUTH_SESSAO_INVALIDA`.
- [x] **CA-09** — **Dado** uma `RefreshSession` (`cliente: WEB`) com `expiraEm` no passado (relógio
      falso no teste unitário), **quando** `POST /auth/refresh` com o cookie dela, **então** 401
      `AUTH_SESSAO_INVALIDA`.
- [x] **CA-10** — **Dado** uma `RefreshSession` `cliente: PWA` (`expiraEm: null`) criada há mais de
      um ano (relógio falso), **quando** `POST /auth/refresh` com o cookie dela, **então** 200 —
      sessão PWA não vence por tempo.
- [x] **CA-11** — **Dado** nenhum `Authorization`, **quando** `GET /auth/me`, **então** 401
      (guard global).
- [x] **CA-12** — **Dado** o `accessToken` do CA-01, **quando** `GET /auth/me` com
      `Authorization: Bearer <token>`, **então** 200 `{ id, email }` do usuário do seed.
- [x] **CA-13** — **Dado** um `accessToken` com `exp` no passado (relógio falso), **quando**
      `GET /auth/me` com ele, **então** 401.
- [x] **CA-14** — **Dado** o cookie e o `accessToken` do CA-01, **quando** `POST /auth/logout`,
      **então** 204, `Set-Cookie` com `Max-Age=0`; no banco, a `RefreshSession` tem `revogadoEm`
      preenchido; **e** um `POST /auth/refresh` seguinte com o mesmo cookie dá 401
      `AUTH_SESSAO_INVALIDA`.
- [x] **CA-15** — **Dado** o mesmo IP, **quando** faço 6 chamadas de `POST /auth/login` em menos de
      1 min (qualquer credencial), **então** a 6ª é 429 `LIMITE_TENTATIVAS`.
- [x] **CA-16** — **Dado** `pnpm db:seed` já rodado uma vez, **quando** rodo de novo, **então**
      ainda existe exatamente 1 `User` com o `SEED_USER_EMAIL`, e a senha dele continua batendo com
      `SEED_USER_PASSWORD` (não duplicou, não quebrou o hash).

## Plano de testes

- **Unitário (Jest; `PrismaService` mockado):**
  - `auth.service.spec.ts`: login certo/errado (CA-01, CA-03, CA-04), geração de `RefreshSession`
    por `cliente` com TTL certa (CA-02), rotação e reuso detectado (CA-06, CA-08), expiração WEB
    vs. não-expiração PWA (CA-09, CA-10), logout revoga (CA-14).
  - `access.guard.spec.ts` (já existe, ganha casos): token válido deixa passar, ausente/expirado
    nega (CA-11, CA-13) — o `@Public()` continua testado como hoje.
  - `dto/login.dto.spec.ts`: formato de `email`/`senha`/`cliente` (CA-05).
  - `seed.spec.ts` ou teste do próprio script: idempotência (CA-16) — se não der para testar via
    Jest (script roda fora do Nest), documentar como verificação manual no plano abaixo.
- **E2E (Jest + supertest, como `health.e2e.spec.ts` já faz):** round-trip completo — login →
  refresh → me → logout → refresh (401); limite de tentativas (CA-15).
- **Manual:** CA-16 se não for cobertro por Jest; inspeção do cookie no DevTools (flags
  `HttpOnly`/`Secure`/`SameSite`) depois de um login real local.

Loop de verificação por tarefa:
`pnpm --filter @solidus/api typecheck` → `pnpm --filter @solidus/api test` → `pnpm lint` →
`pnpm build` → commit.

## Fora de escopo

**Feature do produto:**

- **Revogar todas as sessões de uma vez** (rota de API). A "limpeza" de sessões PWA antigas
  mencionada em "Comportamento esperado" é feita direto no banco (`UPDATE "RefreshSession" SET
"revogadoEm" = now() WHERE ...` ou um script), não uma rota — não há caso de uso pra isso na API
  hoje, com um usuário só.
- **"Esqueci minha senha"** — exigiria envio de e-mail, que não existe no projeto (sem módulo de
  mail, sem decisão de provedor). Fica para quando/se precisar: o reset manual hoje é
  `pnpm db:seed` de novo com uma senha nova no `.env` (apaga o hash antigo pelo upsert).
  **Importante:** isso só funciona enquanto o seed faz upsert por e-mail — qualquer mudança futura
  no seed que vire "criar só se não existir" quebra esse caminho de reset; revisar junto se o seed
  mudar.
- 2FA, captcha, lista de dispositivos conectados (listar/revogar sessão por nome de dispositivo).
- Troca de e-mail (tem um usuário só, decisão de produto, não técnica).
- Ajuste fino do cookie pra deploy cross-site (`SameSite=None` + domínio próprio) — entra quando
  `apps/web` for implantado e a topologia real (mesmo domínio via proxy, ou domínios separados)
  for conhecida.

**Passo de processo (não é critério de aceite):** aprovar as três dependências novas antes de
começar (`RULES.md` §12); rodar a migration e commitá-la; rodar `pnpm db:seed` localmente; gerar
`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (já antecipados no `.env.example`, mas sem valor real
ainda — confirmar que cada um tem ≥ 32 caracteres e são diferentes); atualizar `ARCHITECTURE.md`
(§4.4 deixa de ser "quando a primeira spec chegar", nova seção de modelos Prisma) e
`docs/specs/INDEX.md`.

## Notas de ambiente

Nenhuma variável nova — `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SEED_USER_EMAIL` e
`SEED_USER_PASSWORD` já estão em `env.validation.ts` e `.env.example`, antecipadas para esta spec.
Dependências novas: ver "Stack" (exigem aprovação antes da implementação, `RULES.md` §12).

## Questões em aberto

Decididas pelo humano em 2026-10-02 (ver respostas no histórico da conversa que gerou esta spec):

- [x] **Sessões múltiplas** — decidido: sim, uma `RefreshSession` por login/dispositivo.
- [x] **TTL do refresh** — decidido: 7 dias pra `web`, sem expiração por tempo pra `pwa`.
- [x] **Limite de tentativas de login** — decidido: 5 por minuto por IP.
- [x] **Como o cliente informa que é PWA** — decidido: campo `cliente` no corpo de
      `POST /auth/login`.

## Suposições

Assumidas por mim, sinalizadas para revisão (nenhuma é decisão de negócio já coberta acima):

- **TTL do access token**: 15 min, igual nos dois tipos de cliente (só o refresh varia). Token de
  vida curta não tem por que mudar por dispositivo — é o refresh que decide a frequência de login.
- **Access token no corpo da resposta, não em cookie** (`docs/produto.md` diz "access token curto
  - refresh em cookie httpOnly", lido como access token fora do cookie). Cliente manda
    `Authorization: Bearer <token>` nas rotas autenticadas.
- **Mensagem de erro 400 de validação** segue o padrão que `GlobalExceptionFilter`/`ValidationPipe`
  já produzem hoje — não inventei um formato novo.
- **`senha` sem regra de complexidade** além de não vazia — é o usuário único digitando a própria
  senha escolhida por ele mesmo no `.env`; não há tela de "criar senha" para validar força.
- **Hash do refresh**: SHA-256 hex (64 chars) do token puro, nunca o JWT em claro no banco — mesmo
  princípio de qualquer segredo de uso único, mesmo sem um projeto irmão pra copiar.
- **`cliente` ausente no login** vira `"web"` (o caso mais comum — testar via `curl`/Postman sem
  o campo não deveria cair no comportamento "nunca expira").
