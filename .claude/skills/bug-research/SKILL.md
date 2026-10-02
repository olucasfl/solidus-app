---
name: bug-research
description: Investiga a causa raiz de um bug antes de qualquer correção. Use quando um teste falha, quando uma rota devolve o que não deveria, quando um dado financeiro parece errado, ou quando você está prestes a "tentar uma coisa pra ver se resolve".
---

# Pesquisa de bug — provar a causa antes de corrigir

O erro que esta skill existe para evitar: corrigir o **sintoma que aparece por cima**, achar que
resolveu porque parou de dar erro, e o bug voltar em outra forma depois — particularmente grave
aqui porque o "sintoma por cima" pode ser um número de dinheiro errado que já foi mostrado como
certo.

**A regra que sustenta tudo: não altere código de produção antes do passo 4.**

## Os 6 passos

### 1. Reproduzir

Antes de qualquer leitura de código, defina o caso concreto: qual rota, qual ação, qual dado de
entrada, qual estado esperado × qual estado real.

Se você **não consegue reproduzir**, esse é o resultado desta etapa. Diga o que tentou e o que
falta — e pare.

Reproduza **local**: confirme que o Postgres (`.env` da raiz) está acessível + `pnpm --filter
@solidus/api dev`, depois `curl` contra `http://localhost:3000/...`. Nunca contra qualquer
ambiente que não seja este checkout local — o projeto não tem staging/produção configurados
ainda.

Pontos onde um bug costuma se esconder neste projeto:

- **`packages/shared` desatualizado**: o `dist/` não reflete o `src/` mais recente porque o build
  não rodou de novo. Sintoma: tipo/valor "errado" que já foi corrigido no `src/` do shared.
- **Prisma Client desatualizado**: schema mudou, `db:generate` não rodou.
- **`.env` da raiz não carregado**: `ConfigModule`/Prisma CLI não encontram a variável porque o
  cwd não é o esperado (`ARCHITECTURE.md` §3) — sintoma: "variável obrigatória ausente" mesmo com
  o `.env` preenchido.
- **`ValidationPipe` whitelist**: campo enviado no body não chega no service porque o DTO não o
  declara — `whitelist: true` remove silenciosamente em vez de dar erro óbvio.
- **Dinheiro com float escondido**: um valor que "parece certo" mas tem ponto decimal onde
  deveria ter inteiro de centavos — suspeite sempre que um cálculo financeiro "quase" bate.

### 2. Localizar a causa raiz

Leia o caminho de execução inteiro: controller → `ValidationPipe`/DTO → service → `domain/` (se
houver cálculo) → Prisma. Não pare no primeiro `if` suspeito.

Pergunte **por que** o valor errado chegou ali. E de novo, para a resposta. A causa raiz é aquela
em que a resposta vira "porque foi escrito assim".

### 3. Formular a hipótese

Uma frase testável: _"`TaxaDePoupancaService.calcular()` conta aporte em investimento como
despesa porque o filtro de categoria não exclui `INVESTIMENTO`."_

Se não couber numa frase, você ainda está no passo 2.

### 4. Confirmar

**Este é o portão.** Escreva um teste Jest que falha **pela razão da hipótese**, rode-o e mostre
a saída real da falha. Se passar de primeira, a hipótese está errada: volte ao passo 2.

### 5. Corrigir

Só agora. A **menor** mudança que faz a confirmação do passo 4 deixar de falhar.

Se a correção exigir mudança de schema, remoção de validação, ou mudança de contrato entre
`apps/api` e `packages/shared`, **pare e peça aprovação** com o diff pronto (`RULES.md`).

### 6. Garantir a regressão

O teste do passo 4 **fica no repositório**. Rode `pnpm --filter @solidus/api typecheck`,
`pnpm lint`, `pnpm build`, `pnpm --filter @solidus/api test`.

Na mensagem do commit: o que era, por que acontecia, o que mudou, e como fica garantido que não
volta.

## Anti-padrões

| Sintoma                                  | O que está acontecendo                                           |
| ---------------------------------------- | ---------------------------------------------------------------- |
| "Vou tentar mudar isso e ver se resolve" | Pulou do passo 1 pro 5. Não sabe a causa.                        |
| Corrigiu, mas não escreveu teste         | Sem passo 4/6: o bug volta e ninguém percebe.                    |
| O teste novo passa antes da correção     | O teste não exercita o bug. Não confirma nada.                   |
| A correção mexeu no schema do Prisma     | Não é correção de bug; é mudança de dados. Vai por `/db-change`. |
| "Também aproveitei e arrumei…"           | Vira outra tarefa. Sempre.                                       |
