---
description: Investiga a causa raiz de um bug e corrige — sem editar código de produção antes de confirmar a causa
argument-hint: <descrição do bug ou teste falhando>
---

Bug: **$ARGUMENTS**

Aplique a skill **`bug-research`** integralmente. Ela não é sugestão: é o procedimento.

## O portão

**Não altere código de produção antes do passo 4** (causa raiz confirmada — por teste que falha).
Se você se pegar editando um arquivo em `src/` antes de mostrar essa confirmação, pare e volte.

## Sequência

1. **Reproduzir** — local (`pnpm --filter @solidus/api dev`, depois `curl` contra
   `http://localhost:3000/...`). Nunca contra o Supabase de produção/outro ambiente. Defina
   rota, dado de entrada, e estado esperado × real.
2. **Localizar a causa raiz** — controller → pipe/DTO → service → `domain/` (se houver cálculo) →
   Prisma, inteiro. Pergunte **por que** o valor errado chegou ali, e de novo para a resposta, até
   a causa virar "porque foi escrito assim".
3. **Hipótese** em uma frase testável.
4. **Confirmação** — teste Jest que falha. Se passar de primeira, a hipótese está errada: volte
   ao passo 2.
5. **Corrigir** — a menor mudança possível. Delegue ao agente `bug-fixer` se o escopo for claro.
6. **Regressão** — o teste fica no repo; rode `pnpm --filter @solidus/api typecheck`,
   `pnpm lint`, `pnpm build`.

## Limites

- **Nunca** altere `apps/api/prisma/schema.prisma` como parte de uma correção de bug — vai por
  `/db-change`.
- **Nunca** afrouxe validação de DTO, nem a verificação de centavos/inteiro em `domain/money/`,
  para fazer um teste passar.
- Se o bug está perto de "o sistema quase moveu dinheiro" ou "quase vazou segredo em log", **pare
  e avise** antes de qualquer outra coisa — isso é mais grave que o bug relatado.
- Se a correção mudar o contrato de uma rota ou de um tipo em `packages/shared`, **pare e
  pergunte**.
- Um bug por execução. Achou um segundo? Descreva e siga.
