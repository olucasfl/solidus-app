---
description: Implementa uma spec aprovada — plano curto primeiro, depois código e testes por critério
argument-hint: <caminho-da-spec>
---

Implemente **$ARGUMENTS**.

## 1. Contexto (antes de qualquer edição)

Leia: `.claude/rules/RULES.md` → `CLAUDE.md` → `docs/produto.md` → `ARCHITECTURE.md` (§4 backend,
§5 Prisma/RLS) → a spec passada.

Se a spec não tiver critérios de aceite em BDD, **diga isso** e proponha convertê-los antes de
codar — sem eles, `/qa-verify` não consegue provar nada depois. Se o `Status` da spec não for
`aprovada`, **pare e pergunte** antes de escrever qualquer código.

## 2. Plano curto, antes de editar

Apresente, em no máximo 15 linhas: arquivos que vão mudar, a ordem, e qual critério de aceite
cada passo fecha. **Pare e espere o "ok"** se o plano tocar algo que o `RULES.md` marca como
"Perguntar antes" — em especial mudança em `prisma/schema.prisma`, dependência nova em
`package.json`, ou qualquer coisa perto de mover dinheiro (que é sempre proibido, não só
"perguntar antes" — `RULES.md` §1).

## 3. Implementar, em fatias verticais

Uma fatia = um critério fechado ponta a ponta, não "todos os models e depois todos os
controllers". No backend: model (se houver, com RLS na mesma migration) → service → controller →
DTO → teste. Regra de negócio com cálculo entra em `apps/api/src/domain/` **antes** do service
que a chama, com teste Jest cobrindo os dois lados de qualquer ramificação. Contrato compartilhado
entra em `packages/shared/src` antes de ser usado dos dois lados.

Obrigatório em toda rota nova: DTO com validação (`class-validator`) e limites razoáveis.

## 4. Testar cada critério

Cada critério ganha ao menos um teste Jest que falharia se o comportamento sumisse.
`PrismaService` é sempre mockado como objeto simples (`RULES.md` §5) — nunca instancie
`PrismaClient` real num teste.

## 5. Verificar

```
pnpm --filter @solidus/api typecheck
pnpm lint
pnpm --filter @solidus/api test
pnpm build
```

Se a feature muda `prisma/schema.prisma`: rode `pnpm db:migrate` para gerar a migration
localmente (`RULES.md` §6), confirme com o usuário qual banco é antes (Supabase remoto,
compartilhado por padrão), confira que o diretório gerado em `prisma/migrations/` está no commit,
e rode `pnpm db:check-rls` — tem que passar antes de considerar a fatia fechada.

## 6. Fechar

- Atualize `ARCHITECTURE.md` se o comportamento mudou (módulo novo, feature nova, env var nova) —
  **no mesmo commit**.
- Atualize o status em `docs/specs/INDEX.md`.
- Commit com o **porquê** na mensagem, tipo Conventional Commit correto (`RULES.md` §10).

Se um critério não puder ser fechado, **diga qual e por quê** — não entregue silenciosamente
parcial.
