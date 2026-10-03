# Spec: Taxa de poupança

> Status: implementada (2026-10-03) — **autoaprovada pelo agente sob delegação explícita do humano**
> (modo automático). Revisar as "Suposições" antes de confiar nos números.

## Objetivo

Responder "estou melhorando?" com um número honesto: quanto do que o Lucas ganhou no mês sobrou,
`(receitas − despesas reais) / receitas`, sem contar fatura de cartão duas vezes, aporte como
despesa nem transferência entre contas próprias — e **dizendo quando o número não é confiável**.

## Stack

Padrão da casa, sem dependência nova, **sem mudança de schema** (lê `Transacao`, já categorizada pela
spec 03).

## Comportamento esperado

- **Fórmula** (`docs/produto.md`): `taxa = (receitas − despesas) / receitas`, por mês, tudo em
  centavos inteiros. A natureza vem da taxonomia da spec 03:
  - `receitas` = soma de `valorCentavos` das categorias de natureza **RECEITA**.
  - `despesas` = **menos** a soma de `valorCentavos` das categorias de natureza **DESPESA** (valores
    de saída são negativos; um estorno, positivo, **reduz** a despesa).
  - **NEUTRA** (`INVESTIMENTO`, `PAGAMENTO_FATURA`, `TRANSFERENCIA_INTERNA`) fica fora dos dois lados.
  - **INDEFINIDA** (`A_CLASSIFICAR`) e transação **sem categoria** ficam fora da conta e são
    **reportadas** à parte (quantidade, entradas e saídas em centavos): o sistema não chuta receita.
- `poupancaCentavos = receitas − despesas`. `taxaBasisPoints` é a taxa em pontos-base inteiros
  (1534 = 15,34%), arredondada ao mais próximo (metade para longe do zero), **sem float no
  armazenamento/transporte**. Poupança negativa dá taxa negativa.
- **Receita zero** (ou negativa) → `taxaBasisPoints: null` e aviso `SEM_RECEITA` — nunca divisão por
  zero nem infinito.
- **Avisos** (`avisos`, códigos fixos): `SEM_TRANSACOES` (mês sem nenhuma transação),
  `SEM_RECEITA`, `ENTRADAS_A_CLASSIFICAR` (há entrada indefinida > 0: a receita pode estar
  subestimada e a taxa, portanto, é um limite inferior duvidoso).
- Transações `PENDENTE` entram (compra no cartão pendente já é gasto). Mês = calendário em **UTC**,
  mesmo critério de `GET /transacoes?mes=` (suposição abaixo).
- `porCategoria` lista, para o mês, cada categoria com movimento: `{ categoria, natureza,
quantidade, totalCentavos }` (total **assinado**, como gravado), ordenada por módulo do total desc.
- `GET /poupanca/historico` devolve os últimos N meses (do mais antigo ao mês corrente) com o
  **mesmo cálculo** — é o "estou melhorando?".
- Tudo autenticado.

## Requisitos de saída

| Rota                      | Query                           | Sucesso                                               | Erros                                 |
| ------------------------- | ------------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `GET /poupanca`           | `mes` obrigatório (`YYYY-MM`)   | **200** `PoupancaMes`                                 | 400 (ausente/malformado) · 401        |
| `GET /poupanca/historico` | `meses?` inteiro 1–24, padrão 6 | **200** `{ meses: PoupancaMes[] }` (antigo → recente) | 400 (fora de 1–24, não inteiro) · 401 |

```ts
PoupancaMes = {
  mes: 'YYYY-MM';
  receitasCentavos: number; despesasCentavos: number; poupancaCentavos: number;
  taxaBasisPoints: number | null;
  transacoes: number;                       // todas as do mês, qualquer natureza
  neutras: { quantidade: number };
  indefinidas: { quantidade: number; entradasCentavos: number; saidasCentavos: number };
  porCategoria: { categoria: CategoriaId | 'SEM_CATEGORIA'; natureza: NaturezaCategoria;
                  quantidade: number; totalCentavos: number }[];
  avisos: ('SEM_TRANSACOES' | 'SEM_RECEITA' | 'ENTRADAS_A_CLASSIFICAR')[];
}
```

`saidasCentavos` das indefinidas é positivo (módulo), `entradasCentavos` idem. Transação sem
categoria aparece em `porCategoria` como `SEM_CATEGORIA` (natureza `INDEFINIDA`).

## Modelo de dados

n/a — sem mudança de schema (aditivo ou não). Lê `Transacao` por `groupBy(categoria, tipo)` no intervalo
do mês (o `tipo` separa entradas de saídas nas categorias indefinidas).

## Contrato compartilhado

`packages/shared/src/poupanca.ts`: `PoupancaMes`, `AvisoPoupanca`, `HistoricoPoupancaResponse`.

## Regra de negócio e dinheiro

Toda a conta em `apps/api/src/domain/poupanca/calcular.ts`: função pura, sem Nest/Prisma, em
centavos inteiros (`RULES §2`), com Jest no mesmo commit — inclusive teste de propriedade
(entradas aleatórias → saídas inteiras e identidade `receitas − despesas = poupança`).

## Critérios de aceite (testáveis, em BDD)

- [x] **CA-01** — **Dado** receitas de R$ 10.000,00 e despesas de R$ 6.000,00 no mês, **então**
      `poupancaCentavos = 400000` e `taxaBasisPoints = 4000`.
- [x] **CA-02** — **Dado** movimentos em `INVESTIMENTO`, `PAGAMENTO_FATURA` e `TRANSFERENCIA_INTERNA`,
      **então** não alteram receitas nem despesas e só contam em `neutras.quantidade`.
- [x] **CA-03** — **Dado** uma categoria de despesa com saídas de −R$ 500,00 e um estorno de
      +R$ 100,00, **então** a despesa dessa categoria conta R$ 400,00.
- [x] **CA-04** — **Dado** transações em `A_CLASSIFICAR` (entrada de R$ 3.000,00 e saída de
      R$ 200,00) e uma sem categoria, **então** ficam fora da fórmula, `indefinidas` traz
      quantidade 3 / `entradasCentavos 300000` / `saidasCentavos 20000` (a sem categoria entra aqui
      conforme o sinal) e `avisos` contém `ENTRADAS_A_CLASSIFICAR`.
- [x] **CA-05** — **Dado** receitas zero e despesas de R$ 100,00, **então** `taxaBasisPoints: null`,
      `poupancaCentavos = -10000` e `avisos` contém `SEM_RECEITA`.
- [x] **CA-06** — **Dado** receitas 300 e despesas 200 (centavos), **então** taxa 3333; receitas 300 e
      despesas 100, taxa 6667; despesas maiores que receitas dão taxa negativa (ex.: −2500).
- [x] **CA-07** — **Dado** mês sem nenhuma transação, **então** tudo zero, `taxaBasisPoints: null`,
      `avisos` = `['SEM_TRANSACOES', 'SEM_RECEITA']`, `porCategoria: []`.
- [x] **CA-08** — **Dado** um mês com várias categorias, **então** `porCategoria` traz uma linha por
      categoria com quantidade e total assinado, ordenada por módulo do total desc, e a soma das
      quantidades = `transacoes`.
- [x] **CA-09** — **Dado** `GET /poupanca` sem `mes`, com `mes=2026-13`, `mes=2026-9` ou `mes=abc`,
      **então** 400; sem access token, 401.
- [x] **CA-10** — **Dado** `GET /poupanca?mes=2026-09`, **então** o banco é consultado no intervalo
      `[2026-09-01T00:00Z, 2026-10-01T00:00Z)`.
- [x] **CA-11** — **Dado** `GET /poupanca/historico?meses=3` em 2026-10-15, **então** vêm os meses
      `2026-08`, `2026-09`, `2026-10` nessa ordem; sem `meses` vêm 6; `meses=0`, `25`, `abc`, `1.5`
      → 400.
- [x] **CA-12** — **Dado** o mesmo mês pedido por `/poupanca` e por `/poupanca/historico`, **então** o
      resultado é idêntico (mesmo cálculo).
- [x] **CA-13** — **Dado** 200 conjuntos aleatórios de movimentos, **então** todos os números de
      saída são inteiros e `receitas − despesas = poupança` sempre.
- [x] **CA-14 (real)** — **Dado** a API local com as 1364 transações categorizadas, **então**
      `/poupanca` e `/poupanca/historico` respondem 200; em cada mês com movimento a soma das
      quantidades de `porCategoria` = `transacoes`; a identidade `receitas − despesas = poupança`
      vale; e os avisos refletem a realidade (hoje as entradas por transferência estão
      `A_CLASSIFICAR`).

## Plano de testes

- **Unitário:** `domain/poupanca/calcular.spec.ts` (CA-01 a CA-08, CA-13) · `poupanca.service.spec.ts`
  (CA-10 a CA-12) · DTOs/e2e `poupanca.e2e.spec.ts` (CA-09, CA-11 validação).
- **Real:** CA-14.

## Fora de escopo

- Meta de poupança, comparação com o mês anterior ("melhorou X%") e gráficos — a API devolve os
  números; a leitura é do frontend. Receita recorrente/salário automático. Moedas ≠ BRL (já vêm
  convertidas pelo sync). Fuso America/Sao_Paulo. Frontend.
- Passo de processo: atualizar `ARCHITECTURE.md` e `INDEX.md`.

## Notas de ambiente

Sem variável, dependência ou migration.

## Questões em aberto

Nenhuma bloqueante. **Atenção do humano:** enquanto as entradas por transferência estiverem
`A_CLASSIFICAR` (spec 03), a receita do mês sai quase zero e a taxa não vale nada — o aviso
`ENTRADAS_A_CLASSIFICAR` existe para isso. Criar regras (ex.: nome do pagador do salário →
`SALARIO`) e recalcular resolve.

## Suposições

- Mês em UTC (alguns lançamentos próximos da meia-noite podem cair no mês vizinho do fuso local).
- Pendentes entram na conta.
- Estorno reduz a despesa da própria categoria (não vira receita).
- Taxa em pontos-base inteiros em vez de decimal, para não ter float no contrato.
- `meses` limitado a 24 (24 consultas agregadas em sequência bastam para uso pessoal).
