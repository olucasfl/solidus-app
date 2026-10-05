# Spec: Carteira por Caixinha (saldo manual + rendimento calculado)

> Status: em andamento (2026-10-05) — implementada e verificada contra a API e o banco reais, **menos**
> o que o ambiente não alcança: o CDI ao vivo do BCB e a comparação numérica com o app do Nubank (CA-23). — **autoaprovada pelo agente sob delegação**, depois de o humano
> responder as 5 questões da v1. Dois pontos continuam sendo dele (ver "Para o humano verificar"):
> as **alíquotas de IR/IOF** (são dados editáveis, semeados com a tabela legal que o agente conhece)
> e a **convenção de dia de rendimento** (confirmada comparando com o app do Nubank).

## Objetivo

Saber, a qualquer dia, quanto o Lucas tem em cada Caixinha e quanto ela rende (**bruto e líquido**),
sem depender do Pluggy, que no spike trouxe só ~24% do saldo e nenhum agrupamento por Caixinha
(`docs/decisions/0006-posicoes-manuais.md`). O saldo é **informado por ele**; o rendimento entre
uma informação e outra é **calculado** (CDI × percentual da Caixinha).

## Princípio de projeto (pedido do humano)

**Nada concreto no código.** Quais Caixinhas existem, o percentual do CDI de cada uma, se uma é
"reserva de gastos" e até as alíquotas de IR/IOF são **dados que o usuário edita pela API**, não
constantes. O código só sabe _como calcular_; os números vêm de tabelas. Onde o sistema não tem como
saber algo, ele **mostra o aviso** em vez de chutar.

## Respostas do humano que moldam a spec (2026-10-05)

- 3 Caixinhas: a **Turbo** (> R$ 5 mil, **115% do CDI**) e duas de ~R$ 2 mil cada (**100% do CDI**).
  Existe também a de **Gastos**, que **conta como patrimônio** mas é dinheiro reservado para gastar
  no mês (não é "investido").
- Mostrar **os dois rendimentos**: bruto e líquido (IR e IOF).
- Quer registrar **só o saldo** e também **aportes e resgates**, e gostaria de **automatizar** isso.
- O Nubank **não arredonda**: o cálculo deve ser fiel, sem arredondar no meio do caminho.

## Stack

Padrão da casa. **Sem dependência nova**: o CDI vem da API pública do Banco Central (série SGS 12,
CDI diário, % ao dia) via `fetch`, atrás de uma interface `CdiGateway` (mockada nos testes), no mesmo
molde do `PluggyGateway`. O ambiente onde a spec foi escrita **não alcançava** a API do BCB; o
formato abaixo é o documentado e **não foi verificado ao vivo** (ver "Para o humano verificar").

## Comportamento esperado

### Modelo mental

Uma Caixinha tem **movimentos**, em ordem de data:

- `SALDO` — "neste dia o saldo era X" (a verdade vista no app do banco). Reinicia o cálculo: tudo
  antes dele deixa de importar.
- `APORTE` — entrou dinheiro (vira um novo "lote" com a data de entrada).
- `RESGATE` — saiu dinheiro (consome os lotes **mais antigos primeiro**, FIFO).

O saldo estimado hoje = o último `SALDO` informado + rendimento dia a dia + aportes − resgates
posteriores a ele.

### Rendimento (bruto) — sem arredondar

- Só rende dia **com CDI publicado** (dia útil); fim de semana e feriado não rendem.
- Convenção diária (a confirmar contra o app, ver abaixo): o rendimento do dia `d` incide sobre o
  saldo do **começo** de `d`; aporte/resgate do dia `d` é aplicado **depois** do rendimento de `d`
  (aporte de hoje começa a render amanhã; resgate de hoje ainda leva o rendimento de hoje).
- Fator do dia = `1 + CDI_dia × percentual`. Em inteiros: `CDI_dia` é guardado como inteiro ×10⁸
  (0,055131% a.d. → `55131`) e o percentual em pontos-base (115% → `11500`), então
  `saldo ← saldo × (10¹² + CDI_E8 × percentual_bp) / 10¹²`.
- **Precisão:** o saldo interno é um inteiro de **centavos × 10¹²** (BigInt), sem arredondar por dia.
  Só na **saída** vira centavos inteiros, **truncando** (o app do Nubank mostra o valor truncado; a
  confirmar, ver abaixo). Nunca `float` (`RULES.md` §2).
- Se faltar CDI recente (último CDI com mais de 4 dias), a resposta traz o aviso `CDI_DEFASADO`.

### Rendimento líquido (estimativa de "se eu resgatasse tudo hoje")

Para cada lote: `rendimento = saldo do lote − principal`; **IOF** (regressivo, só nos primeiros 30
dias) incide sobre o rendimento; **IR** (regressivo por prazo) incide sobre `rendimento − IOF`. A
idade do lote = hoje − data de entrada. As alíquotas vêm das tabelas editáveis `FaixaImposto`:

- `SALDO` informado vira um lote só, com idade contada da `dataOrigem` (opcional; padrão = a data
  do saldo). Como o app não diz a idade do dinheiro já dentro da Caixinha, **o líquido é uma
  estimativa conservadora** (idade mínima) a menos que o usuário informe uma `dataOrigem` mais antiga.
- Tabelas vazias → `saldoLiquidoEstimadoCentavos: null` + aviso `IMPOSTO_NAO_CONFIGURADO`.

### Reserva de gastos e patrimônio

Cada Caixinha tem `reservaDeGastos` (booleano editável). O total de **patrimônio** soma **todas** as
ativas; o total **investido** soma as que **não** são reserva; o **disponível para gastar** é a soma
das reservas. Percentual `0` = não rende (ex.: Gastos).

### Automação (o que dá e o que não dá)

- O sync já traz as movimentações "Aplicação RDB"/"Resgate RDB" (categoria `INVESTIMENTO`), **mas o
  Pluggy não diz de qual Caixinha** (descobriu-se: a descrição não traz o nome). Logo **não dá para
  atribuir sozinho**; o que dá é **sugerir**: `GET /movimentos/sugestoes?desde=YYYY-MM-DD` lista as
  transações `INVESTIMENTO` ainda não vinculadas, e ao registrar o movimento o usuário informa o
  `transacaoId`, que vincula (uma transação só pode estar em um movimento).
- Há muita movimentação automática do Nubank (≈230 eventos em 12 meses); por isso `desde` é obrigatório.

### CDI

`POST /cdi/sincronizar` (chamado pelo cron, mesmo token do `/sync`) busca o CDI no BCB desde o dia
mais antigo que importa (o menor entre o movimento mais antigo e o último CDI − 7 dias) e grava em
`CdiDia` (idempotente: não duplica dia).

## Requisitos de saída

Tudo autenticado (`Authorization: Bearer`), exceto `POST /cdi/sincronizar` (header `x-sync-token`,
`@Public()` só para o guard de usuário — mesma justificativa do `/sync`, ADR 0005).

| Rota                                                  | Corpo / query                                                                      | Sucesso                                                       | Erros                                                                                                                                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /caixinhas`                                      | —                                                                                  | **200** lista                                                 | —                                                                                                                                                                                                    |
| `POST /caixinhas`                                     | `{ nome, percentualCdiBp, reservaDeGastos? }`                                      | **201**                                                       | 400                                                                                                                                                                                                  |
| `PATCH /caixinhas/:id`                                | subconjunto de `{ nome, percentualCdiBp, reservaDeGastos, ativa }`                 | **200**                                                       | 400 · 404 `CAIXINHA_NAO_ENCONTRADA`                                                                                                                                                                  |
| `DELETE /caixinhas/:id`                               | —                                                                                  | **204** (apaga os movimentos)                                 | 400 · 404                                                                                                                                                                                            |
| `GET /caixinhas/:id/movimentos`                       | —                                                                                  | **200** em ordem de data                                      | 404                                                                                                                                                                                                  |
| `POST /caixinhas/:id/movimentos`                      | `{ tipo: SALDO\|APORTE\|RESGATE, data, valorCentavos, dataOrigem?, transacaoId? }` | **201**                                                       | 400 (data futura, valor inválido, `dataOrigem` fora do `SALDO`/após a data) · 404 · 409 `TRANSACAO_JA_VINCULADA` · 422 `TRANSACAO_INVALIDA` (não existe, não é `INVESTIMENTO` ou o sentido não bate) |
| `DELETE /movimentos/:id`                              | —                                                                                  | **204**                                                       | 400 · 404 `MOVIMENTO_NAO_ENCONTRADO`                                                                                                                                                                 |
| `GET /movimentos/sugestoes`                           | `desde` (`YYYY-MM-DD`, obrigatório)                                                | **200** transações `INVESTIMENTO` não vinculadas desde a data | 400                                                                                                                                                                                                  |
| `GET /impostos` · `PUT /impostos/:tipo` (`IR`\|`IOF`) | `{ faixas: [{ ateDias: number\|null, aliquotaBp }] }` (substitui a tabela do tipo) | **200**                                                       | 400 (ordem, duplicata, alíquota fora de 0–10000, só a última faixa pode ter `ateDias: null`)                                                                                                         |
| `GET /carteira`                                       | `data?` (`YYYY-MM-DD`, padrão hoje; não futura)                                    | **200** `Carteira`                                            | 400                                                                                                                                                                                                  |
| `POST /cdi/sincronizar`                               | —                                                                                  | **200** `{ dias, novos }`                                     | 401 `SYNC_TOKEN_INVALIDO` · 502 `CDI_INDISPONIVEL` · 429                                                                                                                                             |

`Carteira`: `{ data, caixinhas: [{ id, nome, percentualCdiBp, reservaDeGastos, saldoInformado:
{ data, centavos } | null, saldoBrutoEstimadoCentavos, rendimentoBrutoCentavos, impostos: { iofCentavos,
irCentavos } | null, saldoLiquidoEstimadoCentavos | null, rendimentoLiquidoCentavos | null, avisos[] }],
totais: { patrimonioCentavos, investidoCentavos, disponivelParaGastarCentavos }, avisos[] }`.
Avisos: `SEM_SALDO_INFORMADO`, `CDI_DEFASADO`, `IMPOSTO_NAO_CONFIGURADO`, `RESGATE_ACIMA_DO_SALDO`.

## Modelo de dados

**Aditivo** (4 tabelas novas; RLS + `REVOKE` em todas, `RULES.md` §6).

```prisma
model Caixinha {
  id String @id @default(uuid())
  nome String @db.VarChar(60)
  percentualCdiBp Int            // 11500 = 115%; 0 = não rende
  reservaDeGastos Boolean @default(false)
  ativa Boolean @default(true)
  criadoEm DateTime @default(now())
  atualizadoEm DateTime @updatedAt
  movimentos MovimentoCaixinha[]
}
enum TipoMovimentoCaixinha { SALDO APORTE RESGATE }
model MovimentoCaixinha {
  id String @id @default(uuid())
  caixinhaId String
  caixinha Caixinha @relation(fields: [caixinhaId], references: [id], onDelete: Cascade)
  tipo TipoMovimentoCaixinha
  data DateTime @db.Date
  valorCentavos Int
  dataOrigem DateTime? @db.Date   // só SALDO
  transacaoId String? @unique      // vínculo opcional com a transação do sync
  criadoEm DateTime @default(now())
  @@index([caixinhaId, data])
}
model CdiDia { data DateTime @id @db.Date  taxaE8 Int }
enum TipoImposto { IR IOF }
model FaixaImposto {
  id String @id @default(uuid())
  tipo TipoImposto
  ateDias Int?          // idade máxima do lote em dias (null = sem limite)
  aliquotaBp Int
  @@unique([tipo, ateDias])
}
```

`FaixaImposto` é semeada pelo `db:seed` (só se a tabela do tipo estiver vazia, nunca sobrescreve o que
o usuário editou) com a tabela legal **que o agente conhece**: IR regressivo de renda fixa — até 180
dias 22,5%, até 360 20%, até 720 17,5%, acima 15% — e IOF regressivo sobre o rendimento — 96% no dia
1 caindo até 0% no dia 30 (96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36,
33, 30, 26, 23, 20, 16, 13, 10, 6, 3, 0).

## Contrato compartilhado

`packages/shared/src/carteira.ts`: `Carteira`, `CaixinhaResumo`, `MovimentoCaixinha`, `FaixaImposto`,
`AvisoCarteira`, requests.

## Regra de negócio e dinheiro

Toda a conta em `apps/api/src/domain/carteira/` (puro, sem Nest/Prisma): projeção diária em BigInt,
lotes FIFO, alíquota por idade, impostos. Jest no mesmo commit, inclusive teste de propriedade.

## Critérios de aceite (testáveis, em BDD)

- [x] **CA-01** — **Dado** saldo R$ 1.000,00 em D, CDI de D+1 = `55131` (E8) e 100% do CDI, **então** o
      saldo bruto em D+1 = `100055,131…` centavos → R$ 1.000,55 (truncado); a conta é feita à mão no teste.
- [x] **CA-02** — **Dado** sábado/domingo/feriado sem CDI, **então** o saldo não muda nesses dias.
- [x] **CA-03** — **Dado** o mesmo saldo e CDI com 115% e 100%, **então** o rendimento de 115% é
      `115/100` do de 100% (antes do truncamento).
- [x] **CA-04** — **Dado** 30 dias de CDI, **então** o resultado é igual ao produtório exato em BigInt
      (sem arredondar por dia) e difere do cálculo com arredondamento diário quando este diverge.
- [x] **CA-05** — **Dado** um aporte em D, **então** ele só rende a partir de D+1; **dado** um resgate em
      D, **então** o saldo de D ainda inclui o rendimento de D e depois reduz.
- [x] **CA-06** — **Dado** dois `SALDO`, **então** vale o mais recente e tudo antes dele é ignorado.
- [x] **CA-07** — **Dado** resgates, **então** consomem os lotes mais antigos primeiro (FIFO), inclusive
      resgate parcial de um lote.
- [x] **CA-08** — **Dado** um lote com 10 dias, rendimento R$ 100 e tabelas de IOF/IR, **então** IOF e IR
      batem com o cálculo à mão (IOF sobre o rendimento; IR sobre rendimento − IOF), e lote com > 720
      dias paga 15% de IR e 0% de IOF.
- [x] **CA-09** — **Dado** `FaixaImposto` vazia, **então** líquido `null` + `IMPOSTO_NAO_CONFIGURADO`.
- [x] **CA-10** — **Dado** `dataOrigem` mais antiga num `SALDO`, **então** o IR usa a idade a partir dela.
- [x] **CA-11** — **Dado** última data de CDI com mais de 4 dias de atraso, **então** `CDI_DEFASADO`;
      sem nenhum `SALDO`, `SEM_SALDO_INFORMADO`.
- [x] **CA-12** — **Dado** Caixinhas com `reservaDeGastos` verdadeiro/falso, **então** `patrimonio` =
      soma de todas as ativas, `investido` = as não-reserva, `disponivelParaGastar` = as reservas;
      inativas ficam fora dos três.
- [x] **CA-13** — **Dado** `POST /caixinhas` e `PATCH` com nome vazio, percentual negativo/> 100000 ou
      fracionário, **então** 400; 404 para id inexistente; `DELETE` apaga os movimentos.
- [x] **CA-14** — **Dado** `POST .../movimentos` com data futura, valor fracionário/negativo, `APORTE`
      ou `RESGATE` com valor 0, `dataOrigem` num `APORTE` ou depois da data, **então** 400; `SALDO` com
      valor 0 é válido.
- [x] **CA-15** — **Dado** `transacaoId` de uma transação `INVESTIMENTO` do tipo `DEBITO`, **então**
      só aceita `APORTE`; `CREDITO` só `RESGATE`; já vinculada → 409; inexistente ou de outra
      categoria → 422; valor omitido assume o módulo da transação.
- [x] **CA-16** — **Dado** `GET /movimentos/sugestoes?desde=`, **então** lista só `INVESTIMENTO` não
      vinculadas desde a data; sem `desde` ou malformado → 400.
- [x] **CA-17** — **Dado** `PUT /impostos/IR` com faixas fora de ordem, repetidas, alíquota > 10000 ou
      `ateDias: null` fora da última, **então** 400 e a tabela anterior permanece; válida substitui tudo.
- [x] **CA-18** — **Dado** `POST /cdi/sincronizar` sem token, com token errado e com token certo, **então**
      401/401/200; com o BCB fora do ar, 502 `CDI_INDISPONIVEL` genérico; rodar duas vezes não duplica dias.
- [x] **CA-19** — **Dado** a resposta do BCB (`[{"data":"02/01/2026","valor":"0.055131"}]`), **então** a
      conversão para `taxaE8` é exata por string (nunca `float`): `0.055131` → `55131`; valor malformado
      ou com mais de 6 casas → erro, nunca dado silenciosamente errado.
- [x] **CA-20** — **Dado** 200 entradas aleatórias, **então** todo número de saída é inteiro e o saldo
      nunca é negativo por causa de resgate maior que o saldo (resgate excedente é limitado e avisado).
- [x] **CA-21** — **Dado** as rotas autenticadas sem access token, **então** 401.
- [x] **CA-22** — **Dado** as migrations, **então** `pnpm db:check-rls` passa.
- [~] **CA-23 (real)** — **Dado** a API local, **quando** crio as Caixinhas, informo saldos e consulto
  `/carteira`, **então** responde coerente (com `CDI_DEFASADO` enquanto o CDI não puder ser
  sincronizado); a comparação **numérica** com o app do Nubank é do humano (ver abaixo).

## Para o humano verificar (não dá para o agente provar sozinho)

1. **Alíquotas de IR/IOF**: são dados, semeados com o que o agente conhece da legislação. Confira
   (`GET /impostos`) e corrija pelo `PUT` se divergir.
2. **Convenção do dia de rendimento e truncamento**: informe o saldo de uma Caixinha hoje e, alguns dias
   depois, compare `GET /carteira` com o app. Se divergir de centavos, é a convenção (CA-05) ou o
   truncamento — me diga qual lado errou que ajusto.
3. **API do BCB**: o agente não conseguiu acessá-la; o primeiro `POST /cdi/sincronizar` real é a prova.

## Plano de testes

- **Unitário:** `domain/carteira/*.spec.ts` (CA-01 a CA-12, CA-20) · `cdi.parser.spec.ts` (CA-19) ·
  services (CA-13 a CA-18) · DTOs/e2e (`carteira.e2e.spec.ts`, CA-13 a CA-18, CA-21).
- **Real:** CA-22 e CA-23.

## Fora de escopo

- Comparador líquido entre produtos, reserva de emergência, envelopes, política de gasto (specs
  seguintes); frontend; atribuição **automática** do aporte/resgate à Caixinha (impossível com o
  dado do Pluggy; fica a sugestão); agendar o cron; valores de CDI históricos além do que o BCB serve.

## Notas de ambiente

Sem variável nem dependência nova. `POST /cdi/sincronizar` reutiliza `SYNC_CRON_TOKEN`.

## Questões em aberto

Nenhuma bloqueante (as 5 da v1 foram respondidas). Veja "Para o humano verificar".

## Suposições

- FIFO nos resgates e rendimento depois do aporte no dia seguinte (convenção acima).
- `SALDO` sem `dataOrigem` conta como lote novo na data informada (líquido conservador).
- Truncar (não arredondar) o valor exibido; dia sem CDI não rende (inclui feriado).
- Resgate maior que o saldo é limitado ao saldo e gera aviso, em vez de saldo negativo.
- Caixinha "Gastos" é uma Caixinha comum com percentual `0` (ou o que o usuário definir) e
  `reservaDeGastos: true`.
