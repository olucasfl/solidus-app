---
description: Escreve uma spec nova em docs/specs/ por entrevista dirigida, com critérios de aceite em BDD
argument-hint: <nome-da-feature>
---

Crie a spec de **$ARGUMENTS** em `docs/specs/$ARGUMENTS.md`, a partir de `docs/specs/_TEMPLATE.md`.

## Antes de perguntar qualquer coisa

Leia, nesta ordem: `.claude/rules/RULES.md`, `CLAUDE.md`, `docs/produto.md`, `ARCHITECTURE.md` e
`docs/specs/INDEX.md`. Se já existir spec ou plano para algo parecido, **diga isso e pergunte se é
para estender o que existe** em vez de criar arquivo novo.

## Como conduzir

Faça **perguntas direcionadas, uma de cada vez**, com opções quando fizer sentido. Cubra:
objetivo · comportamento esperado · contrato das rotas (se tocar `apps/api`) · modelo de dados (se
tocar `prisma/schema.prisma` — e se for tabela nova, lembre que ela leva RLS) · regra de negócio
com dinheiro (se houver, confirme que fica em `domain/`, em centavos) · o que entra em
`packages/shared` · erros e limites · critérios de aceite · fora de escopo.

**Não pergunte o que já está claro no pedido ou em `docs/produto.md` — só o que realmente muda o
design.** Teto de **3 perguntas** antes de propor a spec. O que faltar, você assume um padrão
razoável, escreve na spec, e **sinaliza a suposição explicitamente**.

Solidus é single-user e somente leitura (`RULES.md` §1, §3) — se a feature parecer precisar
escrever num banco externo ou mover dinheiro, **pare e pergunte** antes de propor qualquer coisa.

## Regras de conteúdo

- **Critérios de aceite em BDD**: `Dado <estado>, quando <ação>, então <resultado observável>`.
  Se a feature expõe rota HTTP, inclua pelo menos **um caminho de erro** (payload inválido,
  recurso inexistente) além do caminho feliz.
- Nada de "funciona corretamente" ou "está performático" — se não dá para outra pessoa verificar
  com um `curl`, não é critério.
- **"Requisitos de saída" é literal**: método, path, DTO, response, códigos de erro. É dela que
  `/qa-verify` monta a verificação.
- **Modelo de dados**: separe aditivo de destrutivo (`RULES.md` §6). Tabela nova sempre leva
  `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM anon, authenticated` — não é opcional, não
  precisa de pergunta, é padrão da casa (`docs/decisions/0004-rls-sem-policies.md`). Mudança
  destrutiva precisa de aprovação humana explícita registrada na spec.
- Se a feature calcula ou lê valor monetário, confirme que a regra fica em
  `apps/api/src/domain/`, em centavos, com teste Jest previsto no plano de testes.

## Ao terminar

1. Escreva o arquivo com `Status: rascunho`.
2. Adicione a linha correspondente em `docs/specs/INDEX.md`.
3. Liste as suposições que você fez, em bullets, e **pare** — a spec só vira `aprovada` com um
   "ok" explícito do humano. Não comece a implementar.
