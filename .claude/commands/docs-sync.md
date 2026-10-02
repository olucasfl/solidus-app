---
description: Confere se CLAUDE.md, ARCHITECTURE.md, docs/produto.md e docs/specs/INDEX.md batem com a realidade do código
---

Audite a documentação deste repo contra o estado real. Índice que mente é pior que índice que
falta: um agente que lê um `ARCHITECTURE.md` desatualizado toma decisão errada com confiança —
e aqui "decisão errada" pode significar abrir uma rota sem guard ou confundir saldo do Pluggy
com fonte de verdade.

## O que conferir

**1. `CLAUDE.md` × arquivos reais**

- Todo caminho citado existe? (`ARCHITECTURE.md`, `.claude/rules/RULES.md`, `docs/produto.md`,
  `docs/specs/`)
- Os comandos e scripts citados batem com `package.json` da raiz?

**2. `ARCHITECTURE.md` × código**

- Módulos listados em §4 contra `apps/api/src/modules/*` reais. O guard (§4.2) ainda descreve o
  comportamento real (nega tudo, ou já passou a validar token)? Alguma seção descreve
  comportamento que o código não tem mais?

**3. `docs/produto.md` × decisões reais**

- As decisões fechadas ainda são verdade? (Em especial: posições de investimento ainda são
  manuais — `docs/decisions/0006-posicoes-manuais.md` — ou alguém trocou isso sem atualizar o
  ADR?)

**4. `docs/specs/INDEX.md` × `docs/specs/`**

- Toda spec no disco está na tabela? Toda linha aponta para arquivo existente?
- O status (`rascunho`/`aprovada`/`implementada`/`obsoleta`) bate com o que o código tem?

**5. `prisma/schema.prisma` × docs**

- Todo model novo aparece em `ARCHITECTURE.md`? Toda tabela tem a migration de RLS
  correspondente (`ENABLE ROW LEVEL SECURITY` + `REVOKE`)? `pnpm db:check-rls` passa?

**6. Git**

- Alguma spec marcada `implementada` sem commit correspondente? (`git log --oneline -30`)

## Saída

| Arquivo | Linha | Afirma | Realidade | Gravidade |
| ------- | ----- | ------ | --------- | --------- |

Gravidade **alta** quando a afirmação errada levaria a uma decisão ruim (ex.: "auth não existe"
quando já existe, ou "RLS configurado" quando uma tabela nova não tem). **Baixa** quando é só
cosmético.

Depois da tabela, proponha as correções — **e pare**. Aplique só com o "ok" do humano, num commit
de `docs:` separado do trabalho de feature.
