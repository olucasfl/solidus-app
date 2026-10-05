# Índice de specs — Solidus

Mapa único de `spec ↔ status`. **Este arquivo é a fonte da verdade sobre o que existe**; não
confie em adivinhar nome de arquivo. Quem cria ou fecha uma spec atualiza esta tabela no mesmo
commit — `/docs-sync` confere se ela bate com a realidade.

| Feature                   | Spec                                                             | Status                    |
| ------------------------- | ---------------------------------------------------------------- | ------------------------- |
| Fundação e autenticação   | [01-fundacao-auth.md](01-fundacao-auth.md)                       | ✅ implementada           |
| Sync com o Pluggy         | [02-sync-pluggy.md](02-sync-pluggy.md)                           | ✅ implementada           |
| Categorização por regras  | [03-categorizacao.md](03-categorizacao.md)                       | ✅ implementada           |
| Taxa de poupança          | [04-taxa-de-poupanca.md](04-taxa-de-poupanca.md)                 | ✅ implementada           |
| Carteira por Caixinha     | [05-carteira-caixinhas.md](05-carteira-caixinhas.md)             | 🚧 em andamento           |
| Multiusuário              | [06-multiusuario.md](06-multiusuario.md)                         | 🗑️ obsoleta (uso pessoal) |
| Salário e Pix automáticos | [07-salario-e-pix-automatico.md](07-salario-e-pix-automatico.md) | 🚧 em andamento           |

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

**Fase 1 (specs 01 a 04 implementadas; 02, 03 e 04 foram aprovadas pelo agente sob delegação):**

- [ ] **Revisar as "Suposições" das specs 02, 03 e 04** — foram autoaprovadas; nenhuma humana ainda.
- [x] Regra do salário (Sicredi, ≈ R$ 1.044) criada como dado editável; ajustar com `PATCH /regras/:id`
      se o salário mudar de faixa.
- [ ] **Classificar as entradas que sobraram como `A_CLASSIFICAR`** (Pix recebido de outras pessoas etc.):
      são ~R$ 2 a 8 mil por mês, mais que o salário. O sistema não sabe se é renda, reembolso ou dinheiro
      seu movimentado, então a taxa de poupança continua negativa/duvidosa até você decidir.
      `GET /transacoes?categoria=A_CLASSIFICAR`, depois `POST /regras` ou `PATCH /transacoes/:id/categoria`.
- [x] **Multiusuário cancelado (2026-10-05):** o app fica só para o dono, com login obrigatório e sem
      cadastro público. O isolamento por `userId` já feito permanece como defesa em profundidade.
- [ ] **Para o front-end (quando existir):** criar as Caixinhas e informar os saldos; classificar os Pix de
      pessoas que contam como renda/despesa (regras). O CDI se atualiza sozinho e o app se confere com os
      saldos informados (`GET /caixinhas/:id/conferencia`); alíquotas de IR/IOF foram verificadas em
      2026-10-05 (spec 05).
- [ ] No deploy, **medir o `TRUST_PROXY_HOPS`** (ARCHITECTURE.md §7) — sem isso o limite de tentativas é global.
- [ ] Agendar o `POST /sync` (Render Cron Job ou GitHub Actions, ADR 0005) — só quando houver deploy.

Mudanças destrutivas de schema (`/db-change`) e outras aprovações explícitas exigidas por
`.claude/rules/RULES.md` entram aqui quando existirem.
