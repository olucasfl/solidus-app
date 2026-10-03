# Índice de specs — Solidus

Mapa único de `spec ↔ status`. **Este arquivo é a fonte da verdade sobre o que existe**; não
confie em adivinhar nome de arquivo. Quem cria ou fecha uma spec atualiza esta tabela no mesmo
commit — `/docs-sync` confere se ela bate com a realidade.

| Feature                  | Spec                                             | Status          |
| ------------------------ | ------------------------------------------------ | --------------- |
| Fundação e autenticação  | [01-fundacao-auth.md](01-fundacao-auth.md)       | ✅ implementada |
| Sync com o Pluggy        | [02-sync-pluggy.md](02-sync-pluggy.md)           | ✅ implementada |
| Categorização por regras | [03-categorizacao.md](03-categorizacao.md)       | ✅ implementada |
| Taxa de poupança         | [04-taxa-de-poupanca.md](04-taxa-de-poupanca.md) | ✅ implementada |

## Legenda de status

| Status          | Significa                                                 |
| --------------- | --------------------------------------------------------- |
| 📋 prevista     | na Fase 1, ainda sem arquivo escrito                      |
| 📝 rascunho     | spec escrita, ainda não aprovada pelo humano              |
| ✅ aprovada     | aprovada, implementação não começou                       |
| 🚧 em andamento | implementação começou, nem todo critério fechado          |
| ✅ implementada | todos os critérios de aceite verificados por `/qa-verify` |
| 🗑️ obsoleta     | superada por outra spec — diga qual                       |

## Como usar

- **Feature nova:** `/criar-spec <nome>` → gera `docs/specs/<nome>.md` a partir de
  `_TEMPLATE.md` e adiciona a linha aqui.
- **Implementar:** `/implement-story docs/specs/<nome>.md`.
- **Provar que está pronto:** `/qa-verify docs/specs/<nome>.md` — critério a critério, com
  evidência.
- **Requisito mudou:** edite **só a spec** e rode `/spec-sync docs/specs/<nome>.md`. O agente
  compara desejado × implementado × testes e reporta a divergência.

## Ordem da Fase 1

As quatro specs previstas acima são a Fase 1 (Fundação), nesta ordem — cada uma depende da
anterior:

1. **01-fundacao-auth** — usuário único (seed), login, access token + refresh em cookie, guard
   real (hoje nega tudo sem verificar nada).
2. **02-sync-pluggy** — `POST /sync` (protegido por `SYNC_CRON_TOKEN`), conta corrente e cartão
   (que bateram no spike — `docs/produto.md`). Investimentos ficam fora (ver ADR
   `docs/decisions/0006-posicoes-manuais.md`).
3. **03-categorizacao** — regras determinísticas de categoria por transação, incluindo a
   taxonomia real (`CategoriaId` em `packages/shared` ainda é só `string`).
4. **04-taxa-de-poupanca** — `(receitas - despesas reais) / receitas`, aporte não é despesa,
   transferência interna fora da métrica.

## Pendências de execução humana

Nenhuma pendência aberta.

Mudanças destrutivas de schema (`/db-change`) e outras aprovações explícitas exigidas por
`.claude/rules/RULES.md` entram aqui quando existirem.
