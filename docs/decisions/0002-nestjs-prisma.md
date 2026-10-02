# 0002 — NestJS + Prisma no backend

**Status:** aceita · 2026-10-02

## Contexto

Backend single-user, somente leitura, com regras de cálculo determinísticas (taxa de poupança,
IR, comparador) que precisam ser 100% testáveis e isoladas de framework.

## Decisão

NestJS 11 para a camada HTTP/DI, Prisma 6 como ORM, com `apps/api/src/domain/` reservado para
lógica pura (sem import de `@nestjs/*` nem `@prisma/client`).

## Motivo

- Nest dá guard global, `ValidationPipe`, DI e módulos sem reinventar a estrutura.
- Prisma dá migration versionada + client tipado a partir do schema — importante com RLS
  (precisa saber exatamente qual tabela existe para o `db:check-rls`).
- Separar `domain/` do resto é o que permite testar "receitas - despesas reais, aporte não conta"
  sem subir Nest nem mockar Prisma — só função pura + Jest.

## Consequência

Toda regra de cálculo nova entra em `domain/`, testada antes de entrar no service que a chama.
