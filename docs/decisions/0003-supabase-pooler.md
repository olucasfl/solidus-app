# 0003 — Supabase com dois poolers (transaction + session)

**Status:** aceita · 2026-10-02

## Contexto

PostgreSQL 16 gerenciado pelo Supabase. Serverless/containers de vida curta (API em produção,
cron externo) abrem e fecham conexão com frequência; o Prisma Migrate precisa de uma sessão longa
para rodar migration.

## Decisão

`DATABASE_URL` aponta para o **transaction pooler** (porta 6543,
`?pgbouncer=true&connection_limit=1`), usado pela API em runtime. `DIRECT_URL` aponta para o
**session pooler** (porta 5432), usado só pelo Prisma Migrate (`datasource.directUrl` no
`schema.prisma`).

## Motivo

- Transaction pooler escala para muitas conexões curtas sem esgotar o limite do Postgres.
- Prisma Migrate precisa de recursos (advisory locks, `SET` de sessão) que o modo transaction do
  pgbouncer não suporta — sem `DIRECT_URL`, `migrate dev`/`deploy` trava sem erro.

## Consequência

Toda vez que `db:migrate`/`db:deploy`/`db:generate` travar sem mensagem, o primeiro suspeito é
`DIRECT_URL` ausente ou errado — não o schema.
