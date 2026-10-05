# Spec: Salário, fontes de renda e Pix automático

> Status: **em andamento** — aprovada pelo humano em 2026-10-05 (questões 1 a 5 respondidas; ver
> "Decisões do humano"). Código e testes prontos; falta a migration no banco remoto e a verificação manual
> com o Pluggy real (ver "Pendências de execução"). Substitui o "classificar Pix um por um" das
> pendências do `INDEX.md`.

## Objetivo

Fazer a taxa de poupança (spec 04) ficar confiável **sem o usuário classificar Pix à mão**: o
Solidus reconhece _de quem_ veio cada pagamento, o usuário aponta **uma vez** "esse é o meu
salário", e o resto dos Pix entre pessoas é tratado por uma regra automática.

## Stack

Padrão da casa. Sem dependência nova: o hash do documento usa `node:crypto` (HMAC-SHA256).

## Origem do pedido (decisões do humano, 2026-10-05)

- "O Pluggy já classifica" → o Pluggy classifica o **tipo** (Mercado, Transfers, Same person
  transfer, Investments...), mas **não** diz se um Pix recebido é renda, reembolso ou dinheiro
  alheio. A informação que resolve isso é **quem pagou**, e o Pluggy a entrega: no extrato real do
  spike, 170 de 173 Pix recebidos trazem o documento do remetente (28 remetentes distintos).
- Regra automática do Pix: aprovada ("SIM").
- Salário por origem: "esse pagamento é o meu salário → toda vez que essa origem pagar, é salário;
  uma aba com valor, histórico e origem; posso trocar a origem e vale a partir de quando troquei".

## Comportamento esperado

### 1. Guardar de quem veio / para quem foi

- Toda transação nova ou reprocessada do sync grava a **contraparte**: o pagador (se entrada) ou o
  recebedor (se saída), vindo de `paymentData.payer` / `paymentData.receiver` do Pluggy.
- O documento (CPF/CNPJ) **nunca é guardado em claro**: guarda-se `HMAC-SHA256(documento, segredo)`
  como chave de comparação, mais uma máscara para exibir (ex.: `***.123.456-**`) e o nome (do Pluggy
  quando vier; senão extraído da descrição, melhor esforço). Vazamento do banco não expõe CPFs.
- Transação sem contraparte (cartão, tarifa, Pix sem documento) fica com os campos nulos e segue o
  fluxo atual de categorização.

### 2. Fonte de renda (a ideia do salário)

- **"Esse pagamento é o meu salário":** o usuário aponta **uma transação** de entrada; o Solidus
  cria uma `FonteRenda` do tipo `SALARIO` com a contraparte dela, **vigente desde** o primeiro
  recebimento daquela origem. Toda entrada dessa contraparte, passada e futura (a cada sync), vira
  `SALARIO` (receita).
- **"Trocar de onde vem":** o usuário escolhe **qual fonte** quer trocar (`fonteId`) e aponta uma
  transação da **nova** origem. A fonte escolhida é encerrada (`vigenteAte` = dia anterior à data
  dessa transação), nasce uma nova `SALARIO` com `vigenteDesde` = data dessa transação. O
  **histórico anterior continua salário da fonte antiga**; só o que vem da nova origem em diante
  passa a contar pela nova. Nada do passado é reescrito.
- **Pode haver mais de uma fonte de salário vigente ao mesmo tempo** (decisão "flexível" do
  humano): `POST /salario/fonte` **adiciona** uma fonte sem encerrar as outras; trocar mexe só na
  fonte escolhida. A mesma origem não pode ter duas fontes `SALARIO` ativas e sobrepostas (`409`).
- **Renda recorrente automática:** contraparte que **paga em 3 ou mais meses distintos** vira
  `FonteRenda` do tipo `RECORRENTE` (origem `AUTOMATICA`), categoria `OUTRAS_RECEITAS` (receita). O
  usuário pode desativá-la (`ativa = false`) se o Solidus errou, ou promovê-la a salário.
- **Prioridade na categorização (da mais forte para a mais fraca):** regra manual do usuário
  (`/regras`, `PATCH /transacoes/:id/categoria`) > fonte de renda > categoria do Pluggy. Exceção do
  usuário sempre vence a automação.

### 3. Pix entre pessoas, automático (aprovado)

Para os Pix de pessoas que **não** vieram de uma `FonteRenda` e não são do próprio usuário:

- Somam-se, no mês, as saídas e as entradas desses Pix (`liquido = saídas − entradas`).
- **`liquido > 0`** (saiu mais do que entrou): a diferença conta como **despesa**, na categoria
  virtual `PIX_ENTRE_PESSOAS_LIQUIDO`.
- **`liquido < 0`** (entrou mais do que saiu): o excedente **abate despesas** do mês (reembolso), até
  o limite das despesas existentes — **nunca vira receita** e nunca deixa a despesa negativa.
- **`Same person transfer`** (conta própria): entrada e saída ficam `TRANSFERENCIA_INTERNA` (neutras).
  Hoje a **entrada** própria vai para `A_CLASSIFICAR`; passa a ser neutra.
- `A_CLASSIFICAR` deixa de ser o destino padrão dos Pix; só sobra para o que realmente não tem
  contraparte nem categoria.

### 4. Aba do salário (só API; o front vem depois)

- Mostra: **fontes vigentes** (nome + máscara), **valor atual** (soma do último recebimento de cada
  fonte vigente), **histórico** de recebimentos (data, valor, fonte) e **todas as fontes** com suas
  vigências.

### Erros e vazios

- Transação apontada que **não tem contraparte** → `422` com a mensagem de que não dá para criar a
  fonte (use `POST /regras` por descrição).
- Transação de **saída** apontada como salário → `422`.
- Transação de outro usuário ou inexistente → `404`.
- Origem que já tem fonte `SALARIO` ativa → `409`.
- Sem nenhuma fonte de salário → `GET /salario` responde `fontesAtuais: []`,
  `valorAtualCentavos: null` e `historico: []`.

## Requisitos de saída

Todas as rotas autenticadas (nenhuma `@Public()`); dono dos dados = usuário da sessão (`@UserId()`).

- `GET /salario` → `{ fontesAtuais: FonteDto[], valorAtualCentavos: number | null, historico:
{ data, valorCentavos, fonteId, transacaoId }[], fontes: FonteDto[] }`.
- `POST /salario/fonte` body `{ transacaoId }` → `201` com a `FonteDto` criada.
- `PATCH /salario/fontes/:id/trocar` body `{ transacaoId }` → `200` com `{ encerrada: FonteDto, nova: FonteDto }`.
- `GET /renda/fontes` → todas as `FonteDto` (salário e recorrentes).
- `PATCH /renda/fontes/:id` body `{ ativa: boolean }` → `200` com a `FonteDto`.
- `FonteDto` = `{ id, tipo: 'SALARIO' | 'RECORRENTE', origem: 'MANUAL' | 'AUTOMATICA', nome,
docMascarado, vigenteDesde, vigenteAte: string | null, ativa }`. **Nunca** inclui a chave/hash.
- `GET /poupanca?mes=YYYY-MM` (spec 04) passa a refletir o item 3 (despesa líquida de Pix; abatimento) e
  ganha `pixPessoas.liquidoCentavos`.
- `POST /sync?completo=true` (cron/`SYNC_CRON_TOKEN`, spec 02) ignora a janela de 30 dias e reprocessa todo o
  histórico (backfill da contraparte); sem o parâmetro o sync segue incremental. Valor diferente de
  `true`/`false` → `400`.
- `GET /transacoes` (spec 03) passa a trazer `contraparte: { nome, docMascarado } | null` em cada item
  (nunca a chave), para o usuário reconhecer a origem ao apontar o salário.
- Body inválido (`transacaoId` ausente/não-UUID, campo extra) → `400` (ValidationPipe global).

## Modelo de dados

**Tudo aditivo** (nenhum campo removido, nenhum tipo alterado, nenhum obrigatório novo em tabela com
dados) — não exige a aprovação de §6 para mudança destrutiva; passa por `/db-change`.

- `Transacao`: + `contraparteChave String? @db.VarChar(64)`, `contraparteNome String?
@db.VarChar(200)`, `contraparteDocMascarado String? @db.VarChar(20)`; índice
  `[userId, contraparteChave]`.
- Model novo `FonteRenda`: `id`, `userId` (relação `User`, `onDelete: Cascade`), `tipo`
  (`SALARIO | RECORRENTE`), `origem` (`MANUAL | AUTOMATICA`), `contraparteChave`, `nome`,
  `docMascarado`, `vigenteDesde DateTime`, `vigenteAte DateTime?`, `ativa Boolean @default(true)`,
  `criadoEm`, `atualizadoEm`; índice `[userId, contraparteChave]`.
- `enum OrigemCategoria` + valor `FONTE_RENDA` (adição de valor de enum, aditiva).
- `FonteRenda` leva `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM anon, authenticated`, sem policy;
  `pnpm db:check-rls` precisa passar.
- **Backfill:** as transações já gravadas não têm contraparte. Reprocessar o histórico via sync
  completo (o spike devolveu 1.364 transações) para preencher os campos novos — ver questão 4.

## Contrato compartilhado

`packages/shared/src`: `FonteDto`, `SalarioDto`, tipos de request/response acima e a categoria
virtual `PIX_ENTRE_PESSOAS_LIQUIDO` (natureza `DESPESA`). **Decisão de implementação:** ela **não entra em
`CATEGORIAS`** (a taxonomia fechada de 23 ids, que o usuário pode atribuir a uma transação ou regra): é só uma
linha derivada de `porCategoria` na poupança, com `quantidade: 0` (as transações já foram contadas nas
categorias `PIX_*`). Rebuildar o shared antes da api.

## Regra de negócio e dinheiro

Em `apps/api/src/domain/`, **sem Nest nem Prisma**, centavos inteiros (nunca float):

- `renda/detectar-recorrentes.ts` — contrapartes com crédito em ≥ 3 meses distintos.
- `renda/aplicar-fontes.ts` — dada a transação e as fontes (vigência, ativa), decide se é `SALARIO`,
  `OUTRAS_RECEITAS` ou nada; respeita a vigência.
- `poupanca/pix-liquido.ts` — `liquido = saídas − entradas`; despesa se `> 0`, abatimento limitado
  à despesa existente se `< 0`. `calcularPoupanca` o usa.
- `contraparte/hash.ts` — HMAC do documento e máscara (a única função que toca o documento).

## Critérios de aceite (testáveis, em BDD)

- [ ] **Dado** um Pix recebido com `payer.documentNumber`, **quando** o sync grava a transação,
      **então** `contraparteChave` é um hash hex de 64 caracteres, o documento em claro não aparece em
      nenhuma coluna nem em log, e `contraparteDocMascarado` mostra só dígitos parciais.
- [ ] **Dado** uma entrada de uma origem X, **quando** `POST /salario/fonte { transacaoId }`,
      **então** responde `201` com uma `FonteDto` `SALARIO` e todas as entradas de X (passadas e
      futuras) ficam `SALARIO` com origem `FONTE_RENDA`.
- [ ] **Dado** uma fonte de salário A e uma nova origem B, **quando** `PATCH
/salario/fontes/:idDeA/trocar { transacaoId }` com uma transação de B, **então** A fica com
      `vigenteAte` anterior à data dessa transação, B nasce vigente, e as entradas **anteriores** de A
      continuam `SALARIO`.
- [ ] **Dado** duas fontes de salário vigentes (origens X e Y), **quando** troco só a de X,
      **então** a de Y continua vigente e inalterada; `POST /salario/fonte` com uma origem que já tem
      fonte `SALARIO` ativa responde `409`.
- [ ] **Dado** fontes de salário vigentes, **quando** `GET /salario`, **então** vêm as fontes
      vigentes, o valor atual (soma do último recebimento de cada uma) e o histórico ordenado por data
      decrescente.
- [ ] **Dado** uma contraparte que pagou em 3 meses distintos, **quando** o sync roda, **então**
      existe uma `FonteRenda` `RECORRENTE`/`AUTOMATICA` e suas entradas contam como `OUTRAS_RECEITAS`.
- [ ] **Dado** uma fonte `RECORRENTE` automática, **quando** `PATCH /renda/fontes/:id { ativa: false }`,
      **então** deixa de contar como receita.
- [ ] **Dado** num mês Pix de pessoas com saídas maiores que entradas, **quando**
      `GET /poupanca?mes=YYYY-MM`, **então** a diferença entra em `despesasCentavos`.
- [ ] **Dado** entradas maiores que saídas, **então** o excedente reduz `despesasCentavos` sem
      torná-la negativa e **não** aumenta `receitasCentavos`.
- [ ] **Dado** uma regra manual do usuário sobre a transação, **então** ela vence a fonte de renda e a
      categoria do Pluggy.
- [ ] **Dado** uma entrada `Same person transfer`, **então** a categoria é `TRANSFERENCIA_INTERNA`,
      não `A_CLASSIFICAR`.
- [ ] **Dado** uma transação sem contraparte ou de saída, **quando** `POST /salario/fonte`, **então**
      `422`; de outro usuário ou inexistente, `404`; `transacaoId` inválido ou campo extra, `400`.
- [ ] **Dado** o usuário B, **então** nunca vê fontes nem histórico do usuário A (`404`/lista vazia) —
      teste de isolamento do módulo.
- [ ] **Dado** qualquer rota nova sem token, **então** `401`.
- [ ] `FonteDto` e as respostas não expõem `contraparteChave` em nenhum caso.

## Plano de testes

- **Unitário (Jest, `domain/`):** `hash`, `detectar-recorrentes`, `aplicar-fontes` (vigência,
  troca de origem, prioridade), `pix-liquido` (positivo, negativo, limite em zero, mês vazio),
  `calcularPoupanca` com o líquido. Fixtures **sintéticas** (`RULES.md` §8) — nunca nomes ou valores
  do spike.
- **e2e (Jest, `PrismaService` mockado):** as rotas acima, incluindo 400/401/404/422 e isolamento.
- **Manual (uma vez, no fim):** rodar o sync completo contra o Pluggy real, conferir que
  `GET /poupanca?mes=YYYY-MM` deixa de depender de `A_CLASSIFICAR` e que o salário aparece com o histórico.

Loop por tarefa: `pnpm --filter @solidus/api typecheck` → `pnpm --filter @solidus/api test` →
`pnpm lint` → `pnpm build`.

## Pendências de execução

- [x] **Migration** aplicada no Supabase em 2026-10-05 (`salario_e_pix_automatico` + `rls_fonte_renda`);
      `pnpm db:check-rls` passou. **Incidente registrado:** uma chamada interrompida criou o arquivo e a
      rodada seguinte o aplicou _antes_ de eu acrescentar o RLS, então a `FonteRenda` ficou ~1 min sem RLS
      (tabela vazia, nenhum dado exposto). O RLS veio numa segunda migration, porque a primeira já estava
      aplicada e não se edita migration aplicada.
- [x] **Backfill** (`POST /sync?completo=true`): 2 contas, 22 transações novas, 495 atualizadas. Decisão 4
      confirmada: o Pluggy devolve o histórico completo sem `from` e o sync atualiza o que já estava gravado.
- [x] **Privacidade verificada no banco:** 495 transações com chave (todas hex de 64), 0 documentos em claro
      em qualquer coluna.
- [x] **QA contra a API real:** 27/27 verificações de contrato e erro (401/400/404/422), sem criar fonte.
- [ ] **Marcar o salário** (`POST /salario/fonte`) e **revisar as 11 fontes recorrentes** reconhecidas: o humano
      faz quando o front existir. Ver "Achado do backfill".
- [ ] `/qa-verify` formal e fechamento da spec (✅ implementada) depois do item acima.

## Achado do backfill (2026-10-05) — a regra de recorrência pode estar larga demais

As 11 fontes automáticas (agregado, sem nomes): 2 têm valor alto (uma soma ≈ R$ 29 mil em 48 pagamentos
ao longo de 13 meses; outra ≈ R$ 6 mil em 7); **as outras 9 são de valor pequeno** (média de R$ 36 a
R$ 199, total de R$ 108 a R$ 4,7 mil) e a de 55 pagamentos com média de ≈ R$ 85 parece rateio do dia a
dia, não renda. Elas entram como `OUTRAS_RECEITAS` e inflam a receita (R$ 3 a 6 mil por mês contra um
salário de ≈ R$ 1 mil). A regra aprovada (3 meses distintos) faz o que foi pedido, mas o dado real mostra que
**3 meses sozinho não separa renda de rateio recorrente**. Opções, a decidir pelo humano:

1. Manter e desativar à mão as erradas (`PATCH /renda/fontes/:id { ativa: false }`) quando houver front.
2. Endurecer o critério: além de 3 meses, exigir **no máximo ~2 pagamentos por mês** (rateio costuma ser
   frequente e pequeno) e/ou um **valor médio mínimo**.
3. Tratar a detecção como **sugestão** (não entra na receita até o usuário confirmar).

## Fora de escopo

- Front-end da aba "Salário" (só a API; o front começa depois do backend).
- Reconhecer reembolso comparando valores ou datas entre entrada e saída (a regra é só o líquido
  mensal).
- Classificar Pix de **saída** por finalidade (aluguel, presente...): entram no líquido.
- Processo: rodar a migration, atualizar `ARCHITECTURE.md` e o `INDEX.md`.

## Notas de ambiente

- **Variável nova obrigatória:** `CONTRAPARTE_HMAC_SECRET` (segredo aleatório de 32+ bytes, no `.env`
  e no `.env.example` como `<gerado>`). **Trocá-la invalida todas as chaves** (as fontes deixam de
  casar); por isso é gerada uma vez e tratada como o `JWT_*_SECRET`.
- Sem dependência nova.

## Decisões do humano (2026-10-05)

- [x] **1. "Recorrente" = 3 meses distintos.** Aprovado.
- [x] **2. Reembolso abate despesa** até o limite das despesas do mês, sem virar receita
      (opção A). Aprovado.
- [x] **3. Fontes de salário: flexível** ("não sei, deixa flexível") → pode haver mais de uma ao
      mesmo tempo (ver "Fonte de renda").
- [x] **4. Backfill:** o reprocessamento do sync **atualiza** as transações já gravadas para
      preencher a contraparte. Aprovado; **verificar na implementação** que o Pluggy devolve o histórico
      completo sem `from` (o spike trouxe 1.364). Se não devolver, parar e reportar antes de seguir.
- [x] **5. Nome da origem:** extrair da descrição em melhor esforço; sem nome, mostrar a máscara do
      documento. Aprovado.

## Questões em aberto

Nenhuma.
