# 0004 — RLS habilitado sem policies

**Status:** aceita · 2026-10-02

## Contexto

Supabase expõe uma Data API (REST/Realtime) sobre o Postgres, usando as roles `anon` e
`authenticated`. Este projeto **não usa** a Data API — o Prisma, como role `postgres`, é o único
caminho de acesso ao banco. Ainda assim, uma tabela sem RLS fica, por padrão, acessível por
qualquer role com `SELECT` concedido, inclusive via essa Data API se ela for ligada por engano no
futuro.

## Decisão

Toda tabela criada por migration tem `ENABLE ROW LEVEL SECURITY` e `REVOKE ALL FROM anon,
authenticated` — **sem criar nenhuma policy**. Sem policy, RLS habilitado significa "ninguém além
do dono (`postgres`) lê ou escreve", o que basta: o Prisma ignora RLS por ser o dono da tabela.

## Motivo

- É single-user e todo acesso já passa pela API (que faz sua própria autorização). Policies por
  linha (`auth.uid() = user_id`) resolveriam um problema de multi-tenant que este projeto não tem.
- `REVOKE ALL` fecha a porta mesmo se alguém religar a Data API do Supabase por engano depois.

## Consequência

`pnpm db:check-rls` falha o fluxo se uma tabela nova esquecer o `ENABLE RLS`/`REVOKE`. Se um dia o
projeto precisar de multi-tenant real, esta decisão é revisitada — não antes.
