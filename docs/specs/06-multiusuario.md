# Spec: Multiusuário (o Solidus como app para outras pessoas)

> Status: **etapa 1 implementada; etapas 2–5 bloqueadas.** Em 2026-10-05 o humano aprovou ("Sim, pode
> alterar") os itens 1 e 2 abaixo — `RULES.md` §3 e `docs/produto.md` já foram alterados. Os itens 3
> (`userId` obrigatório, `RULES.md` §6) e 4 (provedor de e-mail, `RULES.md` §12) seguem aguardando "sim".

## Origem

Em 2026-10-05 o humano decidiu: _"quero criar um app que não seja somente pra mim, outras pessoas
possam usar também; tem que ser global, não fixo pra mim"_. Hoje o Solidus é single-user por decisão
registrada. Esta spec desenha a mudança e lista exatamente o que precisa ser aprovado.

## O que precisa de aprovação humana (e o diff pronto)

1. **`.claude/rules/RULES.md` §3** — hoje: _"Auth é single-user: **nunca** reabra registro público de
   conta. O único usuário vem do seed."_ Proposta:
   > Auth é multiusuário: o cadastro público é permitido **somente** com e-mail verificado, limite de
   > tentativas e senha com `argon2`; toda consulta de dado financeiro é filtrada pelo usuário da sessão
   > (nunca por parâmetro vindo do cliente) e cada módulo tem teste "usuário A nunca vê dado do B".
2. **`docs/produto.md`** — a "Visão" (_"App pessoal de finanças, de um único usuário (eu, Lucas)"_) e a
   decisão fechada _"Auth single-user: registro desabilitado, usuário único criado por seed"_ passam a:
   _"App de finanças pessoais para qualquer pessoa, cada uma com os próprios dados; contas criadas por
   cadastro com verificação de e-mail."_
3. **`RULES.md` §6 (Perguntar antes)** — a migration que adiciona `userId` obrigatório a tabelas que já
   têm linhas (passo final da migração, abaixo) exige aprovação explícita.
4. **`RULES.md` §12** — provedor de e-mail para verificação (dependência/serviço novo).

Sem os itens 1 e 2 nenhuma das etapas abaixo começa.

## Fato novo que muda o desenho (pesquisado em 2026-10-05)

O **Meu Pluggy é gratuito apenas para uso pessoal** (cada pessoa acessando os próprios dados). Para um
app que conecta bancos de **outras pessoas**, o plano de produção do Pluggy começa em **R$ 2.500/mês**
([Pluggy — Planos e Preços](https://www.pluggy.ai/precos)); há 15 dias de teste e um sandbox sem prazo.
Isso é decisão de negócio, não de código. O desenho abaixo não depende dela: a fonte de dados passa a
ser **por usuário e plugável**, com três modos —

- `PLUGGY_PROPRIO` — a pessoa traz a própria credencial do Meu Pluggy (gratuito para ela; o app guarda
  a credencial **cifrada** com `AES-256-GCM` e nunca a devolve nem a loga);
- `PLUGGY_COMERCIAL` — conexão pelo Pluggy Connect do app, se um dia houver plano pago;
- `IMPORTACAO_ARQUIVO` — extrato OFX/CSV enviado pelo usuário (sem custo nem terceiro).

O `PluggyGateway` atual já é uma interface; vira "uma `FonteDeDados` por conexão".

## Desenho

### 1. Isolamento de dados (o que mais importa)

- Todas as tabelas de dado do usuário ganham `userId`: `Conta`, `SyncRun`, `RegraCategoria`, `Caixinha`
  (`Transacao` e `MovimentoCaixinha` herdam por `Conta`/`Caixinha`, mas também ganham `userId` direto para
  poder filtrar e indexar sem join). Compartilhadas (sem `userId`): `CdiDia` e `FaixaImposto` — são leis e
  índices públicos iguais para todos; só um papel `ADMIN` edita `FaixaImposto`.
- O Prisma conecta como `postgres` (ignora RLS do Postgres), então **o isolamento é feito no código**:
  todo `findMany/update/delete` recebe `userId` da sessão (`@CurrentUser()`), nunca de body/query; id de
  recurso de outro usuário responde **404** (não 403, para não revelar existência).
- Teste obrigatório por módulo: "A cria, B lista/lê/edita/apaga → vazio/404", e uma varredura que falha
  se um service chamar `prisma.<modelo>` sem `where.userId`.

### 2. Cadastro e conta

`POST /auth/registro` (`@Public()`, justificativa desta spec), verificação de e-mail antes do primeiro
login, recuperação de senha, limites por IP (já existem) e por e-mail, senha mínima e `argon2` (já
existe). Fluxo no modelo da spec de verificação do projeto irmão `checkpoint`. Provedor de e-mail
**a definir** (item 4 acima). `DELETE /usuarios/me` apaga a conta e todos os dados (LGPD: exclusão);
`GET /usuarios/me/exportar` devolve os dados (LGPD: portabilidade).

### 3. Conexões e sync por usuário

`Conexao { userId, fonte, credencialCifrada, itemId, ... }` substitui `PLUGGY_ITEM_ID`/`PLUGGY_CLIENT_*`
do `.env`. `POST /sync` do cron percorre as conexões ativas (com pausa entre usuários para respeitar o
limite do Pluggy); `SyncRun` passa a ser por usuário; o limite de 30 dias etc. continua igual.

### 4. O que NÃO muda

Categorização, taxa de poupança, carteira e a regra "tudo é dado editável" continuam; só passam a
filtrar por `userId`. O CDI continua global e automático.

## Migração do dado existente (aditiva primeiro)

1. Adicionar `userId` **opcional** nas tabelas e preencher tudo com o id do usuário atual (o seed).
2. Código passa a filtrar por `userId`; testes de isolamento verdes.
3. **(precisa de "sim" — RULES §6)** tornar `userId` obrigatório e criar os índices/`@@unique` por usuário.
4. Mover `PLUGGY_ITEM_ID` do `.env` para uma `Conexao` do usuário atual.

## Etapas

| Etapa | Entrega                                                                             | Depende            |
| ----- | ----------------------------------------------------------------------------------- | ------------------ |
| 1     | `userId` opcional + backfill + filtro em todos os services + testes de isolamento   | "sim" 1–2          |
| 2     | cadastro, verificação de e-mail, recuperação de senha, exclusão e exportação        | "sim" 4            |
| 3     | `Conexao` + `FonteDeDados` (PLUGGY_PROPRIO e IMPORTACAO_ARQUIVO) + sync por usuário | etapa 1            |
| 4     | `userId` obrigatório + papel ADMIN para impostos                                    | "sim" 3            |
| 5     | (opcional) `PLUGGY_COMERCIAL`                                                       | decisão de negócio |

## Critérios de aceite (rascunho)

- [ ] **CA-01** — **Dado** os usuários A e B, **quando** B lista, lê, edita ou apaga qualquer recurso de A
      (Caixinha, regra, transação, movimento, conexão), **então** 404 e nada muda.
- [ ] **CA-02** — **Dado** uma requisição com `userId` no corpo ou na query, **então** é ignorado/rejeitado:
      o único `userId` válido é o da sessão.
- [ ] **CA-03** — **Dado** o cadastro, **quando** o e-mail não foi verificado, **então** o login é recusado;
      e-mail repetido não revela se a conta existe.
- [ ] **CA-04** — **Dado** `DELETE /usuarios/me`, **então** todos os dados do usuário somem e a sessão cai.
- [ ] **CA-05** — **Dado** a credencial `PLUGGY_PROPRIO`, **então** nunca aparece em resposta, log ou erro, e
      só é decifrada no momento do sync.
- [ ] **CA-06** — **Dado** o sync do cron, **então** uma falha na conexão de A não impede o sync de B.
- [ ] **CA-07** — **Dado** a migração, **então** os dados do usuário atual continuam todos acessíveis a ele,
      sem perda, em cada etapa.

## Fora de escopo

Frontend; app de celular; planos pagos/cobrança do Solidus; login social; 2FA; compartilhar conta entre
pessoas (família); `PLUGGY_COMERCIAL` (decisão de negócio).

## Questões em aberto

- [x] "Sim" do humano para os itens 1–2 (2026-10-05). Faltam os itens 3–4.
- [ ] Provedor de e-mail transacional.
- [ ] O Solidus vai ser cobrado? Se sim, a fonte `PLUGGY_COMERCIAL` (R$ 2.500/mês+) entra no modelo de
      negócio; se não, `PLUGGY_PROPRIO` + `IMPORTACAO_ARQUIVO` bastam.

## Etapa 1 — implementada (2026-10-05)

`userId` opcional + `papel` (`ADMIN`) em `User`, migration `multiusuario_dono_dos_dados` com backfill
(tudo que existia ficou com o usuário do seed). Todo service de dado do usuário recebe o `userId` da
sessão (`@UserId()`, lê o `sub` do access token) como primeiro parâmetro e o põe em todo
`where`/`data`; recurso de outro usuário dá 404. `PUT /impostos/:tipo` exige `AdminGuard` (lê o
`papel` no banco; 403 `ACESSO_NEGADO`). O sync continua com a credencial do `.env`, gravando no nome
do usuário `SEED_USER_EMAIL` (transitório até a etapa 3).

Verificação: `isolamento.spec.ts` varre o código e falha se uma chamada a
`conta|transacao|syncRun|regraCategoria|caixinha|movimentoCaixinha` não mencionar `userId`
(exceção explícita e justificada: o CDI, que é dado público); cada service tem asserções com o
`userId` em todo `where`/`data`; o e2e de impostos cobre o 403. Não foi feita checagem com um segundo
usuário no banco real (bloqueada por segurança): fica para quando houver cadastro (etapa 2).
