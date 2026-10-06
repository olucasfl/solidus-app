# Spec: Envelopes virtuais

> Status: **implementada** — aprovada pelo humano em 2026-10-06 (base do dinheiro = **Caixinhas + conta corrente**; a reserva de
> emergência entra como **envelope automático**, reservando o saldo todo; **sem histórico** de aportes na v1; suposições
> aceitas). Requisito original do produto: _"o dinheiro fica todo no Nubank, mas o app divide em
> envelopes (reserva, viagem, setup...) para mostrar quanto está realmente livre"_.

## Objetivo

Responder "**quanto do meu dinheiro está realmente livre?**": o usuário reparte o dinheiro que tem em **envelopes**
(viagem, setup...), a reserva de emergência já sai reservada sozinha, e o Solidus mostra o que sobra.

## Conceito (para não confundir com o que já existe)

- **Caixinha** (spec 05) é **onde** o dinheiro está (e rende). **Envelope** é **para que** ele serve: uma divisão
  **virtual**, independente das Caixinhas. Um envelope não move nem muda dinheiro nenhum (o Solidus é somente leitura,
  `RULES.md` §1): é só uma anotação do usuário sobre como ele quer repartir o que tem.
- A **reserva de emergência** (spec `reserva-emergencia`) é um envelope **automático e somente leitura**: o app a deriva
  das Caixinhas marcadas, para o mesmo dinheiro nunca contar como "livre" e como "reserva" ao mesmo tempo.

## Stack

Padrão da casa. **Sem dependência nem variável de ambiente nova.** O módulo `envelopes` consome `CarteiraService`
(saldo por Caixinha), `ReservaService` (reserva e meta) e o banco (contas do sync); `ReservaModule` passa a **exportar**
o serviço.

## Comportamento esperado

### 1. De onde vem o dinheiro (decisão do humano: Caixinhas + conta corrente)

- **Caixinhas:** soma, entre as Caixinhas **ativas**, do **valor realizável** de cada uma = saldo **líquido estimado**
  (depois de IR/IOF); se o líquido é `null` (tabelas de imposto vazias), usa o **bruto** daquela Caixinha. É a mesma
  regra da reserva de emergência, de propósito (os dois números se somam sem diferença de base).
- **Conta corrente:** soma do `saldoCentavos` das contas `CORRENTE` e `POUPANCA` gravadas pelo sync (dado do Pluggy, D+1).
- **Fatura do cartão:** **não é descontada** (o saldo do cartão foi gravado cru na spec 02, sem interpretar sinal, fatura
  ou limite). Se existe conta `CARTAO` com saldo diferente de zero, a resposta traz o aviso
  `FATURA_DO_CARTAO_NAO_DESCONTADA`; a spec do cartão (já prevista) corrige depois.
- `totalCentavos = caixinhasCentavos + contaCorrenteCentavos`.

### 2. A reserva de emergência (decisão do humano: automática, saldo todo)

- `reserva.valorCentavos` = soma do valor realizável das Caixinhas **ativas e marcadas** `reservaEmergencia` (a mesma
  regra do saldo da reserva). Entra **inteira** nas contas, mesmo acima da meta (opção A: o "livre" nunca é exagerado).
- `reserva.metaCentavos` vem da spec da reserva; `reserva.excedenteCentavos = max(0, valor − meta)` (só se `meta > 0`),
  **informativo**: o app mostra quanto da reserva já passou da meta, e o usuário decide se quer movê-lo para um envelope.

### 3. Os envelopes do usuário

- Cada envelope tem `nome` (único por usuário), `alocadoCentavos` (**o que o usuário reservou nele**, ≥ 0) e
  `metaCentavos` (opcional). O usuário edita o alocado quando quiser; **não há histórico de aportes** (v1).
- **Progresso** (só com meta): `progressoBp = ⌊alocado × 10000 ÷ meta⌋` (pode passar de 10000), `faltaCentavos =
max(0, meta − alocado)`, `atingida = alocado ≥ meta`. Sem meta, esses três vêm `null`/`null`/`false`.

### 4. O "livre"

`livreCentavos = totalCentavos − reserva.valorCentavos − totalAlocadoCentavos`, com `totalAlocadoCentavos` a soma
dos envelopes do usuário. **Pode ser negativo**: o app **avisa** (`ALOCADO_ACIMA_DO_DISPONIVEL`) e **não esconde nem
recusa** (o usuário pode estar planejando antes de o dinheiro entrar). Criar ou editar um envelope **nunca** é
bloqueado por falta de dinheiro.

### 5. Avisos

`ALOCADO_ACIMA_DO_DISPONIVEL` (livre < 0), `FATURA_DO_CARTAO_NAO_DESCONTADA`, `SEM_CONTA_SINCRONIZADA` (nenhuma conta
corrente/poupança gravada), e os da carteira repassados das Caixinhas ativas: `CDI_DEFASADO`, `SEM_SALDO_INFORMADO`,
`IMPOSTO_NAO_CONFIGURADO`.

## Requisitos de saída

Tudo autenticado (`Authorization: Bearer`); nenhuma rota `@Public()`; dono = usuário da sessão (`@UserId()`).

| Rota                    | Corpo                                                                      | Sucesso                     | Erros                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /envelopes`        | —                                                                          | **200** `EnvelopesResponse` | **401**                                                                                                                                                     |
| `POST /envelopes`       | `{ nome, alocadoCentavos?, metaCentavos? }`                                | **201** `Envelope`          | **400** (nome vazio/longo, valor fracionário/negativo/acima do teto, meta 0, campo extra, `alocadoCentavos: null`) · **409** `ENVELOPE_JA_EXISTE` · **401** |
| `PATCH /envelopes/:id`  | subconjunto de `{ nome, alocadoCentavos, metaCentavos (ou null: remove) }` | **200** `Envelope`          | **400** (idem; `nome`/`alocadoCentavos` `null`; id não-UUID) · **404** `ENVELOPE_NAO_ENCONTRADO` · **409** `ENVELOPE_JA_EXISTE` · **401**                   |
| `DELETE /envelopes/:id` | —                                                                          | **204**                     | **400** (id não-UUID) · **404** `ENVELOPE_NAO_ENCONTRADO` · **401**                                                                                         |

```ts
interface Envelope {
  id: string;
  nome: string;
  alocadoCentavos: number;
  metaCentavos: number | null;
  /** Centésimos de percentual: 5000 = 50%. `null` sem meta; pode passar de 10000. */
  progressoBp: number | null;
  faltaCentavos: number | null;
  atingida: boolean;
}

type AvisoEnvelopes =
  | 'ALOCADO_ACIMA_DO_DISPONIVEL'
  | 'FATURA_DO_CARTAO_NAO_DESCONTADA'
  | 'SEM_CONTA_SINCRONIZADA'
  | 'CDI_DEFASADO'
  | 'SEM_SALDO_INFORMADO'
  | 'IMPOSTO_NAO_CONFIGURADO';

interface EnvelopesResponse {
  disponivel: { caixinhasCentavos: number; contaCorrenteCentavos: number; totalCentavos: number };
  reserva: { valorCentavos: number; metaCentavos: number; excedenteCentavos: number };
  envelopes: Envelope[]; // por data de criação
  totalAlocadoCentavos: number;
  livreCentavos: number; // pode ser negativo
  avisos: AvisoEnvelopes[];
  /** Data de referência do saldo, `YYYY-MM-DD` (UTC). */
  data: string;
}
```

Todo valor em **centavos inteiros**; nenhum `float` no contrato. Limites: `nome` 1–60 caracteres (sem espaços nas pontas),
`alocadoCentavos` 0 a 2.000.000.000 (cabe em `Int`), `metaCentavos` 1 a 2.000.000.000.

## Modelo de dados

**Aditivo** (uma tabela nova; nada existente muda):

```prisma
model Envelope {
  id              String   @id @default(uuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  nome            String   @db.VarChar(60)
  alocadoCentavos Int      @default(0)
  metaCentavos    Int?
  criadoEm        DateTime @default(now())
  atualizadoEm    DateTime @updatedAt

  @@unique([userId, nome])
  @@index([userId])
}
```

`Envelope` é tabela nova: leva `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL ... FROM anon, authenticated`, sem policy, **na mesma
migration que a cria** (lição da spec 07). `pnpm db:check-rls` precisa passar. O model entra em `MODELOS_DO_USUARIO` da
varredura `isolamento.spec.ts`. A migration é gerada **offline** (`prisma migrate diff`) e só é aplicada no Supabase com o
"sim" do humano, com `migrate deploy` (nunca `migrate dev`). **Sem mudança em tabela existente.**

## Contrato compartilhado

`packages/shared/src/envelopes.ts` (os tipos acima). Nenhuma mudança em tipo existente.

## Regra de negócio e dinheiro

Em `apps/api/src/domain/envelopes/`, pura, sem Nest nem Prisma, **centavos inteiros, sem float** (`RULES.md` §2):
`calcularEnvelopes(entrada)` (valor realizável, total, livre, progresso por envelope, excedente da reserva, avisos).
Jest no mesmo commit, com teste de propriedade (resultados inteiros; `livre + reserva + totalAlocado = total`).

## Critérios de aceite (testáveis, em BDD)

- [ ] **Dado** duas Caixinhas ativas (líquidos `A` e `B`) e contas `CORRENTE` e `POUPANCA` (saldos `C` e `P`), **quando**
      `GET /envelopes`, **então** `caixinhasCentavos = A + B`, `contaCorrenteCentavos = C + P` e `totalCentavos` é a soma.
- [ ] **Dado** uma Caixinha com imposto não configurado (líquido `null`), **então** ela entra pelo **bruto** e vem
      `IMPOSTO_NAO_CONFIGURADO`; uma Caixinha **inativa** não entra.
- [ ] **Dado** uma conta `CARTAO` com saldo ≠ 0, **então** o saldo do cartão **não** entra no total e vem
      `FATURA_DO_CARTAO_NAO_DESCONTADA`.
- [ ] **Dado** nenhuma conta corrente/poupança gravada, **então** `contaCorrenteCentavos: 0` e `SEM_CONTA_SINCRONIZADA`.
- [ ] **Dado** Caixinhas marcadas como reserva de emergência, **então** `reserva.valorCentavos` é o valor realizável **inteiro**
      delas (mesmo acima da meta) e **não** aparece como envelope editável (só em `reserva`).
- [ ] **Dado** reserva acima da meta (`meta > 0`), **então** `excedenteCentavos = valor − meta`; abaixo da meta ou sem meta,
      `0`.
- [ ] **Dado** os envelopes `X` e `Y` alocados, **então** `totalAlocadoCentavos = X + Y` e `livreCentavos = total − reserva −
totalAlocado` (`livre + reserva + totalAlocado = total`, sempre).
- [ ] **Dado** alocado maior que o disponível, **então** `livreCentavos` é **negativo**, vem `ALOCADO_ACIMA_DO_DISPONIVEL` e
      o `POST`/`PATCH` **não** foi recusado por isso.
- [ ] **Dado** `POST /envelopes` válido, **então** `201` com `alocadoCentavos: 0` por padrão e `metaCentavos: null`; com
      meta `100000` e alocado `25000`, `progressoBp: 2500`, `faltaCentavos: 75000`, `atingida: false`; com alocado `100000`,
      `atingida: true`; alocado `150000` → `progressoBp: 15000` e `faltaCentavos: 0`.
- [ ] **Dado** `POST` com nome vazio, nome com mais de 60 caracteres, valor fracionário, negativo ou acima de 2.000.000.000,
      meta `0`, `alocadoCentavos: null` ou campo extra, **então** `400` e nada é gravado.
- [ ] **Dado** um nome que o usuário já tem (em `POST` ou `PATCH`), **então** `409 ENVELOPE_JA_EXISTE` e nada muda.
- [ ] **Dado** `PATCH` parcial, **então** só muda o que veio; `metaCentavos: null` **remove** a meta; `nome: null` ou
      `alocadoCentavos: null` → `400` (`null` só vale na meta).
- [ ] **Dado** `PATCH`/`DELETE` de id inexistente → `404 ENVELOPE_NAO_ENCONTRADO`; de id não-UUID → `400`; `DELETE` válido →
      `204` e o valor volta ao "livre".
- [ ] **Dado** o usuário B, **então** nunca vê, edita nem apaga envelopes do A (`404`/lista vazia) — isolamento por módulo.
- [ ] **Dado** qualquer rota nova **sem access token**, **então** `401`.
- [ ] **Dado** as migrations, **então** `pnpm db:check-rls` passa.
- [ ] **Dado** 200 entradas aleatórias, **então** todo número de saída é inteiro e `livre + reserva + totalAlocado = total`.

## Plano de testes

- **Unitário (Jest, `domain/envelopes/`):** valor realizável, total, livre (positivo, zero, negativo), progresso e falta
  (sem meta, abaixo, na meta, acima), excedente da reserva, avisos, teste de propriedade. Fixtures **sintéticas** (nunca
  números do spike).
- **Serviço/e2e (Jest, Prisma mockado):** composição com carteira, reserva e contas; DTOs (400/401/404/409), `null` só na meta,
  nome duplicado, isolamento entre usuários.
- **Real (uma vez, no fim):** com a API local, criar envelopes de teste e conferir `GET /envelopes` contra `/carteira` e
  `/reserva-emergencia` do mesmo instante, depois apagá-los.

Loop por tarefa: `pnpm --filter @solidus/api typecheck` → `pnpm --filter @solidus/api test` → `pnpm lint` →
`pnpm build`.

## Fora de escopo

- **Histórico de aportes/resgates por envelope** e automação do alocado (v1 é só o valor atual que o usuário edita).
- **Vincular um envelope a uma Caixinha** (o envelope é virtual de propósito).
- **Interpretar a fatura do cartão** (spec do cartão, já prevista): aqui só o aviso.
- **Política de investimento / onde aportar** (spec própria; usará o "livre" e a meta dos envelopes).
- Alertas/notificações, front-end (barras de progresso) e envelopes automáticos além da reserva.
- Processo: rodar a migration, atualizar `ARCHITECTURE.md` e o `INDEX.md`.

## Notas de ambiente

Sem variável nem dependência nova. `ReservaModule` passa a exportar o `ReservaService`.

## Suposições (assumidas por padrão; ajuste na revisão)

- **O valor realizável** (líquido, com o bruto de reserva) é a medida de cada Caixinha, igual à da reserva de emergência.
- **A Caixinha de gastos (`reservaDeGastos`) entra no total** como qualquer outra; o app não a trata como "livre".
- **`POUPANCA` conta como conta bancária** junto com `CORRENTE`; `CARTAO` nunca soma.
- **O saldo da conta corrente é o do último sync** (D+1); a defasagem aparece no aviso de conexão do Pluggy, não aqui.
- O alocado **não é validado contra o disponível** (só avisado); um envelope pode ter meta maior que o que existe.
- Nome único por usuário, **sensível a maiúsculas** (`Viagem` e `viagem` são distintos); espaços nas pontas são removidos.
- **Sem histórico:** editar o alocado substitui o valor, não registra um aporte.
- A reserva de emergência **não** é um envelope editável nem aparece em `envelopes[]`: só em `reserva`.
- Nome do arquivo sem número (`envelopes.md`), como o pedido do comando.

## Questões em aberto

- [x] Nenhuma bloqueante. As duas decisões de domínio (base **Caixinhas + conta corrente**; reserva como **envelope
      automático com o saldo todo**) foram do humano em 2026-10-06; as demais são as suposições acima.
