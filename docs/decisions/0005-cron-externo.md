# 0005 — Cron externo em vez de `@nestjs/schedule`

**Status:** aceita · 2026-10-02

## Contexto

O sync diário com o Pluggy precisa rodar uma vez por dia (D+1), mesmo com a API hospedada num web
service free (Render), que **dorme por inatividade**. Um scheduler interno (`@nestjs/schedule`,
`setInterval`) só dispara se o processo estiver de pé no horário — não é garantido num free tier.

## Decisão

`POST /sync`, protegido por `SYNC_CRON_TOKEN` (header, comparação de tempo constante), chamado por
um agendador **externo** ao processo da API: Render Cron Job ou GitHub Actions com `schedule`.

## Motivo

- O agendador externo acorda o processo fazendo a requisição HTTP — não depende do processo já
  estar rodando.
- `SYNC_CRON_TOKEN` evita que a rota seja chamável por qualquer um que descubra a URL; é o único
  "segredo compartilhado" nesse endpoint, não um JWT de usuário (não há usuário nessa chamada).

## Consequência

`POST /sync` é `@Public()` do ponto de vista do guard de usuário, mas **não** é aberto — tem seu
próprio guard/middleware comparando `SYNC_CRON_TOKEN`, implementado junto da spec
`02-sync-pluggy`. Documentar isso na spec é obrigatório (`RULES.md` §3).
