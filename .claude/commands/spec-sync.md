---
description: A spec mudou — compara desejado × implementado × testes e reporta a divergência
argument-hint: <caminho-da-spec>
---

A especificação **$ARGUMENTS** mudou. Analise o impacto.

Este é o comando que faz a spec valer como fonte da verdade: quando um requisito muda, você edita
**só a spec** e roda isto. O contexto vem do arquivo versionado, não da memória de uma conversa.

## Procedimento

1. Leia a spec atual **e o diff dela**: `git diff HEAD -- $ARGUMENTS` e, se commitada,
   `git log -p --follow -- $ARGUMENTS`.
2. Monte três colunas:
   - **Desejado** — o que a spec diz hoje.
   - **Implementado** — o que o código faz hoje (`arquivo:linha`).
   - **Testado** — qual teste Jest garante isso hoje (`arquivo:linha`), ou "nenhum".
3. Classifique cada critério:
   - **em dia** — os três batem.
   - **código atrasado** — a spec pede algo que o código não faz.
   - **teste atrasado** — o código faz, nenhum teste garante.
   - **código órfão** — o código faz algo que a spec não pede mais. **Não apague por conta
     própria**: reporte e pergunte.
4. Verifique os efeitos que a spec sozinha não mostra:
   - A mudança exige alteração de `apps/api/prisma/schema.prisma`? É **aditiva ou destrutiva**?
     Precisa de `/db-change` (com RLS)?
   - Muda contrato de rota ou de um tipo em `packages/shared`? O outro lado do monorepo precisa
     mudar em lockstep quando existir.
   - Passa a calcular ou ler valor monetário sem estar em `domain/`? É um achado, não um detalhe.

## Saída

Uma tabela com as colunas (critério · desejado · implementado · testado · veredito), e depois
**um plano curto** do que precisa mudar, em ordem, marcando o que é pendência humana.

**Pare aí.** Não implemente. Se o humano aprovar, o passo seguinte é `/implement-story`.
