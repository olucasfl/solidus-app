# Spec: Carteira por Caixinha (saldo manual + rendimento calculado)

> Status: **rascunho** (2026-10-03) — escrita pelo agente em modo automático. **Não está aprovada e
> não deve ser implementada** antes de o humano responder as "Questões em aberto": elas definem
> regras de dinheiro (taxa, imposto) que o agente não pode inventar (`RULES.md` §1, §2).

## Objetivo

Saber, a qualquer dia, quanto o Lucas tem em cada Caixinha (Turbo, LL, Investimentos, Gastos…) e quanto
elas rendem, sem depender do Pluggy — que no spike trouxe só ~24% do saldo e nenhum agrupamento por
Caixinha (`docs/decisions/0006-posicoes-manuais.md`). O saldo é **informado por ele**; o rendimento
entre uma informação e outra é **calculado** (CDI × percentual da Caixinha).

## Stack

Padrão da casa. **Sem dependência nova**: o CDI vem da API pública do Banco Central (série SGS 12,
CDI diário, % ao dia) via `fetch`, atrás de uma interface `CdiGateway` (mockada nos testes), no mesmo
molde do `PluggyGateway`. Formato exato da resposta **a confirmar na implementação** (o ambiente onde
esta spec foi escrita não alcançava a API do BCB).

## Questões em aberto — o humano precisa responder

1. **Quais Caixinhas existem e qual % do CDI cada uma rende?** (`docs/produto.md` cita 115% do CDI; é
   igual para Turbo, LL e Investimentos? A "Gastos" rende?)
2. **Imposto:** mostrar só rendimento **bruto**, ou também **líquido estimado** (IR regressivo 22,5% →
   15% por prazo e IOF nos primeiros 30 dias)? Se líquido, o Nubank retém na retirada: como tratar o
   prazo de cada aporte?
3. **Como o saldo muda entre atualizações?** (a) só vale o último saldo informado + rendimento
   calculado; ou (b) ele também registra aportes/resgates entre as datas? Hoje o sync já traz as
   movimentações "Aplicação"/"Resgate" (categoria `INVESTIMENTO`), que poderiam alimentar (b).
4. **Arredondamento:** o Nubank credita rendimento por dia útil com arredondamento ao centavo? (muda
   o saldo calculado em centavos por mês.)
5. **Gastos** conta como patrimônio / reserva ou é dinheiro "já gasto" (fora do total)?

## Comportamento proposto (sujeito às respostas acima)

- **Caixinha** = nome + `percentualCdiBp` (115% = 11500, inteiro) + ativa/inativa.
- **Saldo informado** = (caixinha, data, `saldoCentavos`). Várias por Caixinha; vale a mais recente
  não posterior a "hoje".
- **Rendimento calculado** do saldo informado até hoje: para cada dia útil com CDI publicado depois
  da data informada, `saldo ← saldo × (1 + cdiDiario × percentual)`, em aritmética de inteiros/ponto
  fixo (nada de `float` em dinheiro, `RULES.md` §2), com a regra de arredondamento da questão 4. Dia
  sem CDI publicado (fim de semana, feriado) não rende. Se faltar CDI no intervalo (sync atrasado),
  a resposta traz aviso `CDI_DEFASADO` em vez de calcular com buraco em silêncio.
- **CDI** vem de `POST /cdi/sincronizar` (mesmo esquema de token do `/sync`, chamado pelo cron) e fica
  em tabela própria; o cálculo nunca chama o BCB direto.
- **Carteira** = por Caixinha: último saldo informado, data, rendimento bruto até hoje, saldo estimado
  hoje; total geral (respeitando a questão 5). Tudo autenticado.
- Tudo em `apps/api/src/domain/carteira/` (puro, sem Nest/Prisma, com Jest e teste de propriedade),
  como a taxa de poupança.

## Requisitos de saída (proposta)

| Rota                                                   | O que faz                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| `GET/POST /caixinhas`, `PATCH/DELETE /caixinhas/:id`   | gerenciar Caixinhas                                                  |
| `POST /caixinhas/:id/saldos` `{ data, saldoCentavos }` | informar saldo (400 para data futura, saldo negativo ou não-inteiro) |
| `GET /carteira`                                        | saldo estimado por Caixinha + total + avisos                         |
| `POST /cdi/sincronizar`                                | puxa o CDI do BCB (token do cron)                                    |

## Modelo de dados (proposta, aditivo)

`Caixinha`, `SaldoCaixinha`, `CdiDia` (`data` única; taxa diária em inteiro de ponto fixo, ex.: 1e-8).
Todas com RLS + `REVOKE` (`RULES.md` §6).

## Critérios de aceite (provisórios — só viram definitivos com as respostas)

- [ ] **CA-01** — **Dado** saldo R$ 1.000,00 em D, CDI diário conhecido e 100% do CDI, **quando** passa
      1 dia útil, **então** o saldo estimado = o valor calculado à mão (teste com números fixos).
- [ ] **CA-02** — **Dado** fim de semana/feriado sem CDI, **então** o saldo não muda nesses dias.
- [ ] **CA-03** — **Dado** 115% e 100% do CDI na mesma data/saldo, **então** o rendimento de 115% é
      maior, proporcionalmente.
- [ ] **CA-04** — **Dado** CDI faltando num dia útil do intervalo, **então** aviso `CDI_DEFASADO`.
- [ ] **CA-05** — **Dado** dois saldos informados, **então** vale o mais recente e o cálculo parte dele.
- [ ] **CA-06** — **Dado** saldo com centavos fracionados, negativo ou data futura, **então** 400.
- [ ] **CA-07** — **Dado** qualquer entrada aleatória, **então** toda saída é inteira em centavos.
- [ ] **CA-08** — **Dado** `POST /cdi/sincronizar` sem token / com token errado, **então** 401; com o
      BCB fora do ar, 502 genérico sem vazar o erro original; duas execuções não duplicam dias.
- [ ] **CA-09** — **Dado** o total, **então** soma exatamente as Caixinhas incluídas pela questão 5.
- [ ] **CA-10 (real)** — **Dado** o Lucas informando os saldos de hoje, **então** o estimado de amanhã
      difere do app do Nubank por no máximo a tolerância que ele aceitar (a definir na questão 4).

## Fora de escopo

Comparador líquido, reserva/envelopes, política de gasto (specs seguintes da Fase 2/3); frontend;
cálculo automático de aportes a partir do sync (a menos que a questão 3 escolha a opção b); deploy do
cron.

## Notas de ambiente

Sem variável nem dependência nova prevista. `CDI_SYNC` reutiliza `SYNC_CRON_TOKEN` (a confirmar).
