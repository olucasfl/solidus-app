# ARCHITECTURE.md — Solidus

Guia técnico: estrutura real do repo, convenções, fluxo de Prisma/RLS. `RULES.md` tem precedência
sobre este arquivo quando os dois parecerem dizer coisas diferentes. `docs/produto.md` tem a
visão/decisões de produto; aqui é só o "como o código está organizado".

## 1. Estado atual (vale mais que qualquer resumo — confira a data do último commit)

**Existe:** monorepo pnpm, ESLint 9 (flat) + Prettier + Husky + lint-staged + commitlint,
`apps/api` com NestJS 11 (`health`, `sync` — Pluggy, só leitura; `categorizacao`, `transacoes`, `poupanca`, `renda` (salário e fontes de renda) e `carteira` (Caixinhas, rendimento bruto/líquido); `auth` — usuário único via seed, login, refresh rotativo,
logout, `me`; guard global validando o access token de verdade; `ValidationPipe` global, filtro de
exceção, helmet, CORS, throttler básico com limite próprio no login), `packages/shared` (tipos
`Centavos`/`CategoriaId`/contrato de auth), Prisma com os models `User`/`RefreshSession` (spec
`01-fundacao-auth`) e `Conta`/`Transacao`/`SyncRun`/`RegraCategoria` (specs `02-sync-pluggy` e `03-categorizacao`) e `Caixinha`/`MovimentoCaixinha`/`CdiDia`/`FaixaImposto` (spec `05-carteira-caixinhas`), Jest configurado com teste de domínio, de DTO, de guard e e2e de `/health` e
`/auth/*`. Scripts de spike do Pluggy em `apps/api/scripts/spike/`.

**Não existe:** `apps/web` (só placeholder), comparador, reserva, envelopes, política de gasto e chat (Fase 2 em diante, exceto a carteira), CI/CD, deploy. Cada um entra com sua própria spec
(`docs/specs/INDEX.md`).

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
tenha `@Public()` no método ou na classe. Desde a spec `01-fundacao-auth`, rota não-pública exige
`Authorization: Bearer <accessToken>` — um JWT válido (assinatura + `exp`), verificado com
`JWT_ACCESS_SECRET` via `JwtService` (`@nestjs/jwt`, registrado sem secret default — cada chamada
passa o segredo certo, access ou refresh). Verificação é **stateless**: não consulta o banco a
cada request. O payload (`{ sub: userId }`) fica em `request.user`, lido pelo decorator
`@CurrentUser()` (`common/decorators/current-user.decorator.ts`).

`ApiThrottlerGuard` (`common/guards/api-throttler.guard.ts`, extende o `ThrottlerGuard` do
`@nestjs/throttler`) também é `APP_GUARD`, registrado depois — os dois guards globais rodam em
cadeia; qualquer um que rejeitar encerra a request. É uma subclasse (não o `ThrottlerGuard` puro)
só para o corpo do erro 429 ter `code: 'LIMITE_TENTATIVAS'`, igual todo outro erro do projeto.
`POST /auth/login` sobrescreve o limite global (`@Throttle()`, 5/min em vez do default de 60/min)
— ver `modules/auth/auth.constants.ts`.

### 4.3 `GET /health`

Único endpoint `@Public()` hoje. Checa o banco com `SELECT 1` (`PrismaService.isHealthy()`) e
devolve `{ status, timestamp, database }` — nunca versão ou detalhe interno. Usado por
monitoramento e, futuramente, pelo cron externo antes de chamar `POST /sync`.

### 4.4 Módulo novo

Um módulo por domínio em `apps/api/src/modules/<dominio>/`, registrado em `app.module.ts`. DTO
com `class-validator` em toda rota que aceita body/query (o `ValidationPipe` global é
`whitelist + forbidNonWhitelisted` — campo sem decorator não existe para a API). Regra de negócio
com cálculo vai em `domain/`, não no service do módulo.

### 4.5 `auth` (spec `01-fundacao-auth`)

Só existe o usuário do seed e **não haverá cadastro público** (o app é de uso pessoal, spec 06
obsoleta; não há `POST /auth/registro`). Todo dado é do usuário da sessão: `@UserId()` entrega o `sub`
do access token, os services o põem em todo `where`/`data` (`isolamento.spec.ts` varre o código), recurso
alheio dá 404. `User.papel = ADMIN` libera `PUT /impostos` via `AdminGuard`. `POST /auth/login` (`@Public()`) aceita `{ email, senha, cliente?: 'web' | 'pwa' }` e
devolve `{ accessToken, usuario }` + cookie `solidus_refresh` (`httpOnly`, `Secure` só em
produção). Duas TTLs de refresh por `cliente`: `web` expira em 7 dias; `pwa` não tem TTL no banco
(`RefreshSession.expiraEm: null`) — o cookie em si recebe `Max-Age` de 10 anos só para sobreviver a
reaberturas do app, mas quem decide validade é sempre o banco, nunca o cookie. Múltiplas sessões
simultâneas (uma `RefreshSession` por login/dispositivo).

`POST /auth/refresh` (`@Public()`, lê o cookie) **rotaciona**: revoga a sessão atual e cria uma
nova — reusar um refresh já revogado (token roubado usado depois do dono já ter rotacionado) é
`401 AUTH_SESSAO_INVALIDA`, igual token inexistente ou vencido. `POST /auth/logout` revoga só a
sessão do cookie atual. `GET /auth/me` devolve `{ id, email }` do access token já verificado pelo
guard.

Hash de senha: `argon2`. Hash do refresh no banco: SHA-256 do token puro (nunca o token em claro é
gravado — `modules/auth/tokens.ts`). Erros tipados por `code` (`AUTH_CREDENCIAIS_INVALIDAS`,
`AUTH_SESSAO_INVALIDA`, `LIMITE_TENTATIVAS`), em `modules/auth/auth-errors.ts` e
`common/guards/api-throttler.guard.ts`.

### 4.5 Erros

`GlobalExceptionFilter` (`common/filters/`) intercepta tudo: `HttpException` mantém seu
status/corpo; qualquer outro erro vira 500 genérico (`{ statusCode, message: "Erro interno" }`), e
o detalhe real só vai para o log do servidor (nunca para a resposta, nunca com corpo de request ou
segredo no log).

### 4.6 `sync` (spec `02-sync-pluggy`)

`POST /sync` (chamado pelo cron externo, ADR 0005) lê contas e transações do item `PLUGGY_ITEM_ID` e
grava `Conta`/`Transacao`, **somente leitura no Pluggy** (o `PluggyGateway` só expõe `listar*`; um
teste varre o código atrás de qualquer chamada que não seja `fetch*`). É `@Public()` para o
`AccessGuard` mas **não é aberta**: o `SyncTokenGuard` compara o header `x-sync-token` com
`SYNC_CRON_TOKEN` em tempo constante (digests SHA-256). Idempotente por `pluggyTransactionId`;
sync incremental com janela = data mais recente − 30 dias; só atualiza transação que mudou; uma
execução por vez (409 `SYNC_EM_ANDAMENTO`). Toda execução grava um `SyncRun` (só o `code` do erro,
nunca a mensagem do Pluggy). `GET /sync/status` (usuário) devolve o último `SyncRun`.

**Contraparte (spec 07):** cada transação grava quem pagou (entrada, `paymentData.payer`) ou quem recebeu
(saída, `paymentData.receiver`). O CPF/CNPJ **nunca é gravado em claro**: só `HMAC-SHA256(documento,
`CONTRAPARTE_HMAC_SECRET`)` (`contraparteChave`, chave de comparação), uma máscara (`***.456.789-**`) e o nome
(o do Pluggy ou, em melhor esforço, o que vem depois do `|` na descrição do Pix). Tudo isso mora em
`domain/contraparte/documento.ts`, o único arquivo que toca o documento. Sem documento válido não há
contraparte. **`POST /sync?completo=true`** ignora a janela de 30 dias e reprocessa todo o histórico (backfill
da contraparte nas transações antigas) e reaplica a categorização em tudo.

**Dinheiro:** centavos inteiros via `domain/money/centavos.ts#reaisParaCentavos`; o mapeamento
Pluggy → modelo vive em `domain/sync/mapear.ts` (puro). **O sinal vem do `type`, não do valor
cru**: no Pluggy a conta corrente manda `DEBIT` negativo, mas o cartão manda a compra (`DEBIT`)
positiva e o pagamento (`CREDIT`) negativa — verificado com dados reais agregados. Transação em moeda
estrangeira usa `amountInAccountCurrency`; sem ele conta em `semConversao`.

### 4.7 `categorizacao` e `transacoes` (spec `03-categorizacao`)

A taxonomia é **fechada e vive em `packages/shared/src/categoria.ts`** (23 categorias, cada uma com
`natureza`: RECEITA, DESPESA, NEUTRA ou INDEFINIDA — é isso que a taxa de poupança usa). A
categorização é regra pura em `domain/categorizacao/` (substring sem acento/caixa, **nunca regex**).
Precedência: manual > regra do usuário (`RegraCategoria`, prioridade desc, empate = mais antiga) >
**fonte de renda (spec 07, §4.10)** > regra padrão > fallback (débito → `OUTRAS_DESPESAS`, crédito → `A_CLASSIFICAR`).

**Regras por descrição vêm antes do mapa de categorias do Pluggy**, porque o Pluggy classifica o
"Pagamento de fatura" da conta corrente como `Transfers` (contaria a fatura duas vezes como
despesa). Pix/transferência de e para pessoas (`Transfers` do Pluggy) tem categoria própria
(`PIX_RECEBIDO_DE_PESSOAS` / `PIX_ENVIADO_PARA_PESSOAS`), **neutra por padrão** e sempre reportada à
parte pela taxa de poupança: o app é global, então não presume que Pix recebido é renda nem que Pix
enviado é gasto (aluguel, cliente, reembolso... só o usuário sabe) — ele cria uma regra para contá-lo.
Transferência entre contas próprias (`Same person transfer`) é `TRANSFERENCIA_INTERNA` (neutra) nos dois
sentidos desde a spec 07; o que o sistema não entende continua `A_CLASSIFICAR`: não adivinha receita.

**Nada que dependa de valor ou de nome está fixo no código.** O que define "isso é salário" é regra
do usuário (`RegraCategoria`), com faixa de valor opcional e editável por `PATCH /regras/:id` (salário
mudou → ajusta a regra). O jeito preferido de dizer "isso é salário" é a **fonte de renda** (§4.10): o
usuário aponta uma transação e a origem inteira passa a valer.

Persistência: `Transacao.categoria` (String validada contra a taxonomia) + `origemCategoria`
(`REGRA_USUARIO`, `REGRA_PADRAO`, `MANUAL`, `FONTE_RENDA`). Transações novas são categorizadas ao fim de cada sync
(falha aí é logada e não derruba o sync); `POST /categorizacao/recalcular` reaplica as regras em
tudo que não é manual (criar/apagar regra não recalcula sozinho). Rotas, todas autenticadas:
`GET /categorias`, `GET/POST /regras`, `DELETE /regras/:id`, `POST /categorizacao/recalcular`,
`GET /transacoes` (filtros `mes`, `categoria`; paginação), `PATCH /transacoes/:id/categoria`.

### 4.8 `poupanca` (spec `04-taxa-de-poupanca`)

`GET /poupanca?mes=YYYY-MM` e `GET /poupanca/historico?meses=N` (1–24, padrão 6), autenticadas, sem
mudança de schema: o service agrupa `Transacao` por `(categoria, tipo)` no mês (calendário **UTC**) e
a conta inteira é a função pura `domain/poupanca/calcular.ts`. `taxa = (receitas − despesas) /
receitas`, em pontos-base inteiros (sem float no contrato); só categorias de natureza RECEITA e
DESPESA entram — NEUTRA (fatura, aporte, transferência própria) fica fora, estorno reduz a despesa.
**INDEFINIDA e sem categoria são reportadas à parte (`indefinidas`) e geram aviso
`ENTRADAS_A_CLASSIFICAR`; receita zero devolve taxa `null` + `SEM_RECEITA`** — o número nunca é
apresentado como confiável quando não é. **Pix de e para pessoas** que não são renda contam pelo
**líquido do mês** (spec 07, `aplicarPixLiquido` em `calcular.ts`): `saídas − entradas`. Saiu mais →
a diferença é despesa (linha virtual `PIX_ENTRE_PESSOAS_LIQUIDO` em `porCategoria`, fora da taxonomia, com
`quantidade` 0 porque as transações já foram contadas). Entrou mais → o excedente **abate despesa** (reembolso),
até o limite das despesas, e **nunca vira receita**. `pixPessoas` leva `liquidoCentavos` e
`abatimentoCentavos`; o aviso `PIX_ENTRE_PESSOAS_FORA_DA_CONTA` deixou de existir.

### 4.9 `carteira` (spec `05-carteira-caixinhas`)

Saldo **informado pelo usuário** por Caixinha + rendimento **calculado** (CDI × percentual), bruto e
líquido, sem depender do Pluggy (ADR 0006). **Nada concreto no código**: Caixinhas, percentual do CDI,
`reservaDeGastos` e as alíquotas de IR/IOF são linhas de banco que o usuário edita
(`/caixinhas`, `PUT /impostos/:tipo`); as tabelas de imposto são **semeadas** pelo `db:seed` com a
tabela legal conhecida (só se estiverem vazias; nunca sobrescrevem edição) e o cálculo só lê o banco.

A conta é `domain/carteira/projetar.ts` (puro): saldo interno em **BigInt, centavos × 10¹²**, sem
arredondar por dia (o Nubank não arredonda); só na saída vira centavos, **truncando**. O `SALDO` de um
dia vale no fim dele; só rende dia com CDI publicado; resgate consome os lotes mais antigos (FIFO).
**Ordem entre movimento e rendimento no mesmo dia (`ConvencaoRendimento`):** o padrão é
`MOVIMENTO_ANTES_DO_RENDIMENTO` (aporte rende desde o dia da aplicação; resgate não leva o rendimento do
dia em que saiu — regra usual de RDB/CDB com liquidez diária), mas isso **varia por banco e não dá para
garantir pela internet**, então é dado por Caixinha (`convencaoRendimento`, `null` = padrão) e o app
**se confere sozinho**: `GET /caixinhas/:id/conferencia` compara, para cada par de saldos que o usuário
já informou, o que estimaria com o que ele informou, nas duas convenções, e sugere a que erra menos
(sem trabalho extra; se os saldos não distinguem, não sugere nada). Líquido = estimativa "se
resgatasse tudo hoje", por lote: IOF sobre o rendimento, IR sobre o que sobra, alíquotas pela idade do
lote.

**CDI automático:** vem do BCB (SGS série 12, % ao dia) e se mantém sozinho — `CdiService`
(`atualizarSeNecessario`) é chamado ao subir e a cada `GET /carteira`/conferência: se há movimento e o
CDI gravado está atrasado (ou falta histórico), busca no BCB, no máximo uma tentativa a cada 15 min,
uma por vez e com espera máxima de 5 s; se o BCB falhar, a carteira responde com o que tem e o aviso
`CDI_DEFASADO`. O `POST /cdi/sincronizar` (token do cron) continua como reforço. Guardado como
**inteiro × 10⁸** e convertido **por string** (`domain/carteira/bcb.ts`) — nunca `float`; formato
inesperado é erro, não dado errado. Formato real da API conferido em 2026-10-05.

**Alíquotas (verificadas em 2026-10-05):** IR regressivo de renda fixa — 22,5% até 180 dias, 20% de 181
a 360, 17,5% de 361 a 720, 15% acima (confirmado na página oficial da Receita Federal "Tributação de
2026", atualizada em 27/04/2026; a MP que tentou mudar isso caducou) — e IOF regressivo sobre o
rendimento, 96% no 1º dia até 0% no 30º, "limitado ao rendimento" (Decreto 6.306/2007; confirmado em
regulamentos de fundos na CVM/B3 e várias fontes; o anexo do decreto no Planalto não pôde ser lido
diretamente). **Não existe feed oficial legível por máquina de alíquotas**: elas são dado editável
(`PUT /impostos/:tipo`), semeado com estes valores, e mudam só por lei (anunciada com antecedência).
O que muda todo dia — o CDI — é automático. O Pluggy não diz de qual Caixinha é cada "Aplicação/Resgate
RDB", então o sync só **sugere** (`GET /movimentos/sugestoes`) e o usuário vincula.

### 4.10 `renda` (spec `07-salario-e-pix-automatico`)

Uma **fonte de renda** (`FonteRenda`) é uma origem (a `contraparteChave`) que paga renda: `SALARIO` (o
usuário apontou uma transação: `POST /salario/fonte`) ou `RECORRENTE` (o Solidus reconheceu: a origem pagou
em 3+ **meses distintos**, só entre Pix de pessoas). Vale por **dia (UTC)** entre `vigenteDesde` e
`vigenteAte`; entrada da origem nesse intervalo vira `SALARIO` (ou `OUTRAS_RECEITAS`, na recorrente) com
origem `FONTE_RENDA`. A regra pura vive em `domain/renda/` (`aplicar-fontes.ts`, `detectar-recorrentes.ts`);
`categorizar()` a consulta entre a regra do usuário e o padrão (a exceção do usuário vence a automação).

**Trocar de onde vem** (`PATCH /salario/fontes/:id/trocar`): encerra só a fonte escolhida no dia anterior à
transação e abre a nova nesse dia, numa `$transaction`; o passado da origem antiga continua dela. Pode haver
mais de uma fonte de salário vigente ao mesmo tempo (`409 FONTE_JA_EXISTE` só para a mesma origem).
Uma fonte recorrente que o usuário **desativou** (`PATCH /renda/fontes/:id`) nunca é recriada pelo
reconhecimento automático. Toda mudança chama `CategorizacaoService.recalcular`, que respeita a categoria
manual.

Rotas (todas autenticadas, dono = usuário da sessão; recurso alheio = 404): `GET /salario` (fontes vigentes,
valor atual = soma do último recebimento de cada fonte vigente, histórico, todas as fontes), `POST
/salario/fonte`, `PATCH /salario/fontes/:id/trocar`, `GET /renda/fontes`, `PATCH /renda/fontes/:id`. **Os
DTOs nunca levam a chave do documento**, só nome e máscara; `GET /transacoes` ganhou `contraparte {nome,
docMascarado}` para a pessoa reconhecer a origem. Erros 422 usam `code` estável (`NAO_E_ENTRADA`,
`SEM_CONTRAPARTE`, `FONTE_NAO_VIGENTE`, `MESMA_ORIGEM`, `DATA_ANTERIOR_AO_INICIO`).

## 5. Prisma e RLS

- **Modelos hoje** (`schema.prisma`): `User` (usuário único, criado pelo seed) e `RefreshSession`
  (uma por login/dispositivo; `cliente: WEB | PWA` decide a TTL do refresh — spec
  `01-fundacao-auth`, `ARCHITECTURE.md` §4.5). `Conta`, `Transacao` e `SyncRun` (spec `02-sync-pluggy`, valores sempre em centavos `Int`),
  `RegraCategoria` (spec 03) e `Caixinha`, `MovimentoCaixinha`, `CdiDia` (CDI × 10⁸) e `FaixaImposto`
  (spec 05), e `FonteRenda` (spec 07; `Transacao` ganhou `contraparteChave`/`Nome`/`DocMascarado`). A taxa de
  poupança (spec 04) não tem tabela própria: lê `Transacao`.
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

Contratos, sem nada específico de Node ou browser (`window`, `fs`, `@prisma/client` ficam de fora).
Hoje: `Centavos`; o contrato de auth, sync, transações/regras e poupança; e a **taxonomia fechada de
categorias** (`CATEGORIAS`, `CategoriaId`, `naturezaDe` — a única exceção "com lógica": uma tabela
constante e dois helpers puros, porque API e web precisam da mesma lista). Cresce conforme `apps/web`
precisar do mesmo shape que `apps/api` expõe.

## 7. Variáveis de ambiente

Validadas no boot por `apps/api/src/config/env.validation.ts` — falha rápido, mensagem lista só o
nome da variável com problema, nunca o valor. Lista completa (com comentário do propósito de cada
uma) em `.env.example`, na raiz.

**`CONTRAPARTE_HMAC_SECRET`** (obrigatória, 32+ caracteres): segredo do HMAC que transforma o documento da
contraparte em chave de comparação (spec 07). Gerada uma vez, como os `JWT_*_SECRET`; **trocá-la invalida todas
as chaves já gravadas** (as fontes de renda deixam de casar e o backfill `POST /sync?completo=true` precisa
rodar de novo).

**`TRUST_PROXY_HOPS`** (opcional, 0–10, ausente = 0): quantos proxies confiáveis existem entre o cliente e
a API. Em dev fica ausente. No deploy (Render etc.) o `req.ip` seria o do proxy e o limite por IP
(login 5/min, `/sync` 5/min) viraria um contador único para o site todo — por isso o valor tem de ser
**medido** na hospedagem real (comparar o IP real com o `X-Forwarded-For` recebido), nunca chutado e
nunca `true` (confiaria em qualquer cabeçalho e deixaria o IP forjável). Teste de regressão em
`app.setup.trust-proxy.e2e.spec.ts`.

## 8. O que falta documentar aqui

Esta seção existe para não fingir completude: as specs `01` a `04` (toda a Fase 1) já estão documentadas (§4.5 a §4.8, §5).
A Fase 2 (investimentos manuais por Caixinha, comparador, reserva) começa com specs novas — não assuma
nenhuma delas como existente. `apps/web` também começa do zero (hoje é só placeholder).
