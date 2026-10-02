# Spec: <nome da feature>

> Status: rascunho | aprovada | em andamento | implementada | obsoleta

## Objetivo

<Uma frase: o que esta feature permite ao usuário do Solidus que hoje não é possível.>

## Stack

<Só o que diverge do padrão da casa. Se seguir `ARCHITECTURE.md` inteiro, escreva "padrão da
casa" e siga em frente. Se divergir (biblioteca nova, padrão diferente), diga **o quê** e
**por quê** — dependência nova exige aprovação (`RULES.md` §12).>

## Comportamento esperado

- <entrada / ação do usuário> → <saída / efeito observável>
- <regra de negócio — se envolver cálculo, diga a fórmula exata, não "calcula corretamente">
- <o que acontece no erro: mensagem, status>
- <o que acontece no caso vazio (lista sem itens, recurso inexistente)>

## Requisitos de saída

<O contrato. Método, path, shape do DTO de entrada, shape do response, códigos de erro. Este
bloco é o que `/qa-verify` usa para montar a evidência — seja literal.>

## Modelo de dados

<Se a feature exige model novo ou campo novo em `apps/api/prisma/schema.prisma`: descreva o shape
e classifique — aditivo (model novo, campo opcional novo) ou destrutivo (campo removido, tipo
alterado, obrigatório novo em tabela com dados). Destrutivo exige aprovação explícita
(`RULES.md` §6) e passa por `/db-change` na implementação. Toda tabela nova leva
`ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM anon, authenticated`, sem policy — não escreva
"n/a" para isso. Se não houver mudança de schema, escreva "n/a".>

## Contrato compartilhado

<O que vai para `packages/shared/src` (tipos de request/response usados por `apps/api` e
`apps/web` ao mesmo tempo, quando o web existir). Se a feature é só de um lado, escreva "n/a".>

## Regra de negócio e dinheiro

<Se a feature calcula ou lê valor monetário: confirme que fica em `apps/api/src/domain/`, em
centavos, inteiro (nunca float) — `RULES.md` §2. Se não envolve dinheiro, escreva "n/a".>

## Critérios de aceite (testáveis, em BDD)

- [ ] **Dado** <estado inicial>, **quando** <ação>, **então** <resultado observável>.
- [ ] **Dado** <estado inicial>, **quando** <ação>, **então** <resultado observável>.

<Regras para escrever um critério útil:
— o "então" tem que ser verificável por alguém que não escreveu o código (um `curl`);
— nada de "funciona corretamente", "está performático", "a UI está boa";
— um critério por comportamento, não um critério por rota inteira;
— toda rota HTTP tem pelo menos um critério de payload inválido.>

## Plano de testes

- **Unitário (Jest):** <quais arquivos, o que cada um cobre>
- **Manual:** <o que só dá para verificar rodando a aplicação de ponta a ponta>

Loop de verificação por tarefa:
`pnpm --filter @solidus/api typecheck` → `pnpm --filter @solidus/api test` → `pnpm lint` →
`pnpm build` → commit.

## Fora de escopo

- <o que NÃO faz parte desta entrega, registrado para não voltar como "faltou">
- <separe **feature do produto** de **passo de processo**: rodar a migration, atualizar
  `ARCHITECTURE.md`, configurar runner são processo, não critério de aceite>

## Notas de ambiente

- <variável de ambiente nova (e o `.env.example` correspondente), dependência nova
  (`RULES.md` §12) — tudo que exige decisão explícita.>

## Questões em aberto

- [ ] <pergunta que muda o design e ainda não foi respondida — se não houver, escreva "Nenhuma">
