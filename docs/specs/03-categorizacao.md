# Spec: Categorização por regras

> Status: implementada (2026-10-03) — **autoaprovada pelo agente sob delegação explícita do humano**
> (modo automático). Revisar as "Suposições" antes de confiar nos números.

## Objetivo

Classificar cada transação do Solidus em uma categoria de uma taxonomia fechada, por regras
determinísticas (sem LLM), e — mais importante para a spec 04 — dar a cada categoria uma
**natureza** (receita, despesa, neutra, indefinida) para a taxa de poupança não contar fatura de
cartão duas vezes, nem aporte como despesa, nem transferência entre contas próprias.

## Stack

Padrão da casa, sem dependência nova. Casamento de regra por **substring sem acento e sem caixa**,
nunca regex (usuário cria regras; regex abriria ReDoS).

## Achado que molda o desenho (dados reais agregados, 2026-10-03)

- O Pluggy já devolve categoria em 100% das transações, mas ela **não separa o que a taxa de
  poupança precisa**: o "Pagamento de fatura" debitado da conta corrente vem como `Transfers`
  (despesa aparente) e o "Pagamento recebido" no cartão como `Credit card payment` — contar os dois
  duplicaria a fatura. As regras por **descrição** vêm antes do mapa de categorias do Pluggy.
- `Investments` (aplicação, débito; resgate, crédito) é movimentação neutra, não despesa nem renda.
- `Transfers` de entrada (a maior fonte de crédito) é ambígua: pode ser salário, reembolso ou
  dinheiro de outra conta própria. Vai para `A_CLASSIFICAR` — **o sistema não adivinha receita**.
  A spec 04 reporta quanto ficou indefinido em vez de embutir um palpite na taxa.

## Taxonomia (lista fechada, em `packages/shared`)

| id                        | nome                      | natureza   |
| ------------------------- | ------------------------- | ---------- |
| `MORADIA`                 | Moradia                   | DESPESA    |
| `MERCADO`                 | Mercado                   | DESPESA    |
| `RESTAURANTES_DELIVERY`   | Restaurantes e delivery   | DESPESA    |
| `TRANSPORTE`              | Transporte                | DESPESA    |
| `SAUDE`                   | Saúde                     | DESPESA    |
| `LAZER`                   | Lazer                     | DESPESA    |
| `EDUCACAO`                | Educação e livros         | DESPESA    |
| `ASSINATURAS_COMUNICACAO` | Assinaturas e comunicação | DESPESA    |
| `COMPRAS`                 | Compras                   | DESPESA    |
| `VIAGENS`                 | Viagens                   | DESPESA    |
| `DOACOES`                 | Doações                   | DESPESA    |
| `IMPOSTOS_TARIFAS`        | Impostos e tarifas        | DESPESA    |
| `SERVICOS`                | Serviços                  | DESPESA    |
| `TRANSFERENCIAS_ENVIADAS` | Transferências enviadas   | DESPESA    |
| `OUTRAS_DESPESAS`         | Outras despesas           | DESPESA    |
| `SALARIO`                 | Salário                   | RECEITA    |
| `RENDIMENTOS_CASHBACK`    | Rendimentos e cashback    | RECEITA    |
| `OUTRAS_RECEITAS`         | Outras receitas           | RECEITA    |
| `INVESTIMENTO`            | Aplicações e resgates     | NEUTRA     |
| `PAGAMENTO_FATURA`        | Pagamento de fatura       | NEUTRA     |
| `TRANSFERENCIA_INTERNA`   | Entre contas próprias     | NEUTRA     |
| `A_CLASSIFICAR`           | A classificar             | INDEFINIDA |

`SALARIO`, `OUTRAS_RECEITAS` e `MORADIA` não saem de nenhuma regra padrão (o Pluggy não as
distingue): só por regra do usuário ou categoria manual.

## Comportamento esperado

- **Precedência (primeira que casa vence):** (1) categoria **manual** da transação; (2) regras do
  **usuário**, por `prioridade` decrescente e, no empate, a mais antiga; (3) regras **padrão**;
  (4) fallback: débito → `OUTRAS_DESPESAS`, crédito → `A_CLASSIFICAR`.
- **Regras padrão, na ordem:**
  1. descrição contém `pagamento de fatura` ou `pagamento recebido` → `PAGAMENTO_FATURA`
  2. categoria Pluggy `Same person transfer` → `TRANSFERENCIA_INTERNA`
  3. categoria Pluggy `Investments` ou `Fixed income`, ou descrição contém `aplicação`/`resgate`
     → `INVESTIMENTO`
  4. mapa da categoria Pluggy: `Groceries`→`MERCADO`; `Eating out`, `Food delivery`→
     `RESTAURANTES_DELIVERY`; `Taxi and ride-hailing`, `Parking`, `Gas stations`, `Automotive`→
     `TRANSPORTE`; `Pharmacy`→`SAUDE`; `Cinema, theater and concerts`, `Tickets`, `Gambling`→
     `LAZER`; `Bookstore`, `Office supplies`→`EDUCACAO`; `Digital services`, `Telecommunications`→
     `ASSINATURAS_COMUNICACAO`; `Shopping`, `Online shopping`, `Clothing`, `Electronics`,
     `Sports goods`, `Kids and toys`→`COMPRAS`; `Travel`→`VIAGENS`; `Donations`→`DOACOES`;
     `Tax on financial operations`→`IMPOSTOS_TARIFAS`; `Services`→`SERVICOS`; `Cashback`
     (crédito)→`RENDIMENTOS_CASHBACK`; `Transfers` débito→`TRANSFERENCIAS_ENVIADAS`;
     `Transfers`/`Third party transfers` crédito→`A_CLASSIFICAR`.
- **Persistência:** `Transacao.categoria` + `Transacao.origemCategoria` (`REGRA_USUARIO`,
  `REGRA_PADRAO`, `MANUAL`). Transação sem categoria (`null`) é categorizada ao fim de cada sync
  (falha na categorização é logada e **não** derruba o sync). `POST /categorizacao/recalcular`
  reaplica as regras em tudo que **não** é `MANUAL` — é a forma de uma regra nova valer para o
  histórico (criar/apagar regra não recalcula sozinho).
- **Manual:** `PATCH /transacoes/:id/categoria` com uma categoria válida fixa `MANUAL` (nunca mais
  mexido por regra); com `null` solta a transação e ela é reavaliada pelas regras na hora.
- Texto de regra: 1–120 caracteres após `trim`; comparação normaliza acento, caixa e espaços
  repetidos. Regra pode restringir a `tipo` (`DEBITO`/`CREDITO`).
- Tudo autenticado (nenhuma rota `@Public()`).

## Requisitos de saída

Todas exigem `Authorization: Bearer` (401 do guard global sem ele).

| Rota                              | Corpo / query                                                                  | Sucesso                                                                                                                                                               | Erros                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /categorias`                 | —                                                                              | **200** `[{ id, nome, natureza }]` (a taxonomia)                                                                                                                      | —                                                                                               |
| `GET /regras`                     | —                                                                              | **200** `[{ id, padrao, categoria, tipo, prioridade }]`                                                                                                               | —                                                                                               |
| `POST /regras`                    | `{ padrao, categoria, tipo?, prioridade? }`                                    | **201** a regra criada                                                                                                                                                | 400 (padrão vazio/longo, categoria fora da taxonomia, tipo inválido, prioridade fora de 0–1000) |
| `DELETE /regras/:id`              | —                                                                              | **204**                                                                                                                                                               | 400 (id não-UUID) · 404 `REGRA_NAO_ENCONTRADA`                                                  |
| `PATCH /transacoes/:id/categoria` | `{ categoria: string \| null }`                                                | **200** `{ id, categoria, origemCategoria }`                                                                                                                          | 400 (categoria inválida / id não-UUID) · 404 `TRANSACAO_NAO_ENCONTRADA`                         |
| `POST /categorizacao/recalcular`  | —                                                                              | **200** `{ analisadas, alteradas }`                                                                                                                                   | —                                                                                               |
| `GET /transacoes`                 | `mes?` (`YYYY-MM`), `categoria?`, `pagina?` (≥1), `limite?` (1–200, padrão 50) | **200** `{ total, pagina, limite, itens: [{ id, contaId, data, descricao, valorCentavos, tipo, status, moeda, categoria, origemCategoria }] }` ordenado por data desc | 400 (mes malformado, categoria inválida, paginação inválida)                                    |

## Modelo de dados

**Aditivo** (colunas opcionais novas em `Transacao`, 1 tabela nova). RLS + `REVOKE` na tabela nova.

```prisma
enum OrigemCategoria { REGRA_USUARIO REGRA_PADRAO MANUAL }

// em Transacao:
//   categoria       String?          @db.VarChar(40)   // id da taxonomia, validado no código
//   origemCategoria OrigemCategoria?
//   @@index([categoria])

model RegraCategoria {
  id         String         @id @default(uuid())
  padrao     String         @db.VarChar(120)
  categoria  String         @db.VarChar(40)
  tipo       TipoTransacao?
  prioridade Int            @default(0)
  criadoEm   DateTime       @default(now())
}
```

A taxonomia fica em código (`packages/shared`), não em tabela: mudá-la é decisão de spec, e `String`
evita migration a cada categoria nova.

## Contrato compartilhado

`packages/shared/src/categoria.ts`: `CATEGORIAS` (a tabela acima, `as const`), `CategoriaId` (união
derivada), `NaturezaCategoria`, `Categoria`, `naturezaDe(id)`; `categoria.ts` substitui o
`CategoriaId = string` provisório. Tipos de request/response das rotas em `packages/shared/src/transacoes.ts`.

## Regra de negócio e dinheiro

A categorização é regra pura em `apps/api/src/domain/categorizacao/` (normalização de texto,
ordem de precedência, regras padrão), sem Nest/Prisma, com Jest no mesmo commit. Não calcula
dinheiro; só lê `valorCentavos` (inteiro) para os filtros de listagem.

## Critérios de aceite (testáveis, em BDD)

- [x] **CA-01** — **Dado** "Pagamento de fatura" (débito, Pluggy `Transfers`) e "Pagamento recebido"
      (crédito, Pluggy `Credit card payment`), **então** ambas → `PAGAMENTO_FATURA` (natureza NEUTRA).
- [x] **CA-02** — **Dado** crédito "Resgate…" com Pluggy `Investments` e débito "Aplicação…" com
      Pluggy `Investments`, **então** ambos → `INVESTIMENTO`.
- [x] **CA-03** — **Dado** Pluggy `Same person transfer` (débito ou crédito), **então**
      `TRANSFERENCIA_INTERNA`.
- [x] **CA-04** — **Dado** crédito com Pluggy `Transfers`, **então** `A_CLASSIFICAR` (INDEFINIDA);
      **dado** débito com Pluggy `Transfers`, **então** `TRANSFERENCIAS_ENVIADAS` (DESPESA).
- [x] **CA-05** — **Dado** cada categoria Pluggy do mapa (uma por linha da regra 4), **então**
      devolve a categoria do Solidus listada; **dado** uma categoria Pluggy desconhecida, débito →
      `OUTRAS_DESPESAS`, crédito → `A_CLASSIFICAR`.
- [x] **CA-06** — **Dado** "COMPRA NO DÉBITO – Padaria São José" e a regra de usuário
      `padaria` → `MERCADO`, **então** casa mesmo com caixa e acento diferentes ("PADARIA", "pádaria")
      e a origem é `REGRA_USUARIO`, **vencendo** a regra padrão (Pluggy `Shopping`).
- [x] **CA-07** — **Dado** duas regras de usuário que casam, prioridade 10 e prioridade 5, **então**
      vale a de prioridade 10; **dado** empate de prioridade, vale a mais antiga.
- [x] **CA-08** — **Dado** uma regra restrita a `CREDITO`, **então** ela não casa um débito.
- [x] **CA-09** — **Dado** o padrão `a.*b` (caracteres de regex), **então** é tratado como texto
      literal (não casa "axxb").
- [x] **CA-10** — **Dado** `POST /regras` com padrão vazio, com 121 caracteres, só espaços,
      categoria inexistente, tipo inválido ou prioridade 1001, **então** 400 em cada caso e nada é
      gravado; **dado** válido, 201 com a regra.
- [x] **CA-11** — **Dado** `GET /regras` e `DELETE /regras/:id` existente → 204 e some da lista;
      inexistente → 404 `REGRA_NAO_ENCONTRADA`; id não-UUID → 400.
- [x] **CA-12** — **Dado** `PATCH /transacoes/:id/categoria` com categoria válida, **então** 200 com
      `origemCategoria: "MANUAL"`; com categoria inexistente → 400; id inexistente → 404
      `TRANSACAO_NAO_ENCONTRADA`.
- [x] **CA-13** — **Dado** uma transação `MANUAL` e outra `REGRA_PADRAO` para a qual uma regra de
      usuário nova passou a casar, **quando** `POST /categorizacao/recalcular`, **então** a manual
      permanece intacta (e não entra em `analisadas`), a outra passa à categoria da regra de usuário
      e `alteradas` = 1; uma segunda chamada devolve `alteradas: 0`.
- [x] **CA-14** — **Dado** `PATCH` com `categoria: null` numa transação manual, **então** ela volta a
      ser categorizada por regra (origem `REGRA_USUARIO` ou `REGRA_PADRAO`).
- [x] **CA-15** — **Dado** um sync que grava transações novas (`categoria` nula), **então** ao fim
      elas estão categorizadas; **dado** a categorização lançando erro, **então** o sync ainda
      responde 200 e o erro é logado sem dado pessoal.
- [x] **CA-16** — **Dado** `GET /transacoes?mes=2026-09&categoria=MERCADO&limite=2&pagina=1`,
      **então** só vêm transações de setembro/2026 e de MERCADO, no máximo 2, com `total` correto,
      ordenadas por data desc; `mes=2026-13`, `limite=500`, `pagina=0`, `categoria=XYZ` → 400.
- [x] **CA-17** — **Dado** qualquer das 6 rotas sem access token, **então** 401.
- [x] **CA-18** — **Dado** a taxonomia, **então** toda categoria tem natureza e `naturezaDe` a
      devolve; o conjunto bate com a tabela deste documento (teste compara ids).
- [x] **CA-19** — **Dado** as migrations, **então** `pnpm db:check-rls` passa com `RegraCategoria`.
- [x] **CA-20 (real)** — **Dado** a API local com as 1364 transações já sincronizadas,
      **quando** `POST /categorizacao/recalcular`, **então** nenhuma fica sem categoria, os 40
      pagamentos de fatura de cada lado são `PAGAMENTO_FATURA`, e o agregado por natureza
      (contagens, sem texto pessoal) é coerente com as regras.

## Plano de testes

- **Unitário (Jest):** `domain/categorizacao/normalizar.spec.ts`, `categorizar.spec.ts` (CA-01 a
  CA-09), `shared` via `categorias.spec.ts` na api (CA-18), `categorizacao.service.spec.ts`
  (CA-12 a CA-15), DTOs (`regra.dto.spec.ts`, `listar-transacoes.dto.spec.ts`, CA-10, CA-16).
- **E2E (supertest, Prisma mockado):** `categorizacao.e2e.spec.ts` (CA-10 a CA-12, CA-16, CA-17).
- **Real:** CA-19 e CA-20.

## Fora de escopo

- Cálculo de qualquer total/taxa (spec 04); detecção automática de salário; regras com regex;
  aprendizado/sugestão de regras; renomear/criar categorias; split de transação; frontend.
- Passo de processo: rodar a migration; atualizar `ARCHITECTURE.md` e `INDEX.md`.

## Notas de ambiente

Sem variável nem dependência nova.

## Questões em aberto

Nenhuma bloqueante.

## Suposições

- `Gambling` → `LAZER` (poderia ter categoria própria; fica para o usuário decidir por regra).
- `Services` → `SERVICOS` (despesa genérica) por não haver como saber mais.
- Débito `Transfers` conta como despesa (`TRANSFERENCIAS_ENVIADAS`): Pix para terceiros sai do bolso;
  se for entre contas próprias, o usuário cria regra → `TRANSFERENCIA_INTERNA`.
- Crédito `Transfers` fica `A_CLASSIFICAR`: salário e reembolso não são distinguíveis sem regra.
- Estorno (`Shopping` crédito) cai em `COMPRAS` com valor positivo, reduzindo a despesa da categoria.
- Descrição casa por substring simples; "aplicação"/"resgate" em descrição de outra natureza
  (ex.: "Aplicação de verniz" numa compra) seria mal classificada — risco baixo, corrigível por manual.
- `limite` máximo 200 e paginação por `pagina` (offset) bastam para o volume pessoal.
