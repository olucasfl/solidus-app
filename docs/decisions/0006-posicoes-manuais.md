# 0006 — Posições de investimento manuais, não via sync do Pluggy

**Status:** aceita · 2026-10-02

## Contexto

Spike do Pluggy (`docs/produto.md`) comparou o retorno da API contra o app do Nubank: Caixinhas
somam R$ 6.832,75 no Nubank, mas o Pluggy devolveu R$ 1.653,43 (~76% ausente), sem nenhum campo
que agrupe os lotes de CDB/RDB por Caixinha (Turbo/LL/Investimentos/Gastos).

## Decisão

Posição de investimento (saldo por Caixinha) é **entrada manual** do usuário, com rendimento
calculado localmente (115% do CDI, lido da API do Banco Central). Os lotes que o Pluggy retorna
entram como **dado auxiliar** (cross-check), nunca como fonte de verdade do saldo.

## Motivo

- O gap de 76% já descarta "confiável hoje". Mesmo que o backfill do Pluggy complete depois, não
  existe campo que mapeie lote → Caixinha — o produto quer saldo por Caixinha, não por lote.
- Rendimento por fórmula (115% CDI) é determinístico e testável (`domain/`), sem depender de uma
  sincronização externa incompleta.

## Consequência

A spec `02-sync-pluggy` cobre conta corrente e cartão (que bateram exatamente no spike) via sync
automático; a spec de investimentos (Fase 2) cobre a entrada manual de saldo por Caixinha e o
cálculo de rendimento — são specs e fluxos diferentes, não a mesma rota.
