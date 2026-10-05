# Produto — Solidus

Memória do produto para sessões futuras. O que muda rápido (estado de implementação) vive em
`docs/specs/INDEX.md`; o que muda devagar (visão, decisões fechadas, fases) vive aqui.

## Visão

App de finanças pessoais **de uso pessoal** (uma conta só, a do Lucas, com login obrigatório), para
responder três perguntas:
**"posso gastar isso?"**, **"onde coloco esse dinheiro?"**, **"estou melhorando?"**.

O app organiza, calcula e verifica regras minhas. **Não é consultor** (não dá recomendação de
investimento) e **nunca move dinheiro** — é somente leitura, sempre.

## Decisões fechadas

Não reabra sem motivo técnico forte (ver `.claude/rules/RULES.md` para como pedir exceção).

- **Dados externos**: Meu Pluggy via `pluggy-sdk` (Client ID/Secret só em env, nunca commitados).
  Sync D+1 (uma vez por dia), somente leitura. Dados de mercado: API do Banco Central
  (CDI/Selic/IPCA) e brapi.dev (B3).
- **Stack**: monorepo pnpm (`apps/api` NestJS 11, `apps/web` React+Vite PWA — pendente,
  `packages/shared`), TypeScript 5 strict, Prisma 6, PostgreSQL 16 no Supabase, Jest. SDK da
  OpenAI só na Fase 4 (chat, GPT-5 mini), atrás de uma interface `LlmProvider`.
- **Cálculo determinístico**: toda regra de negócio pura (IR, IOF, taxa de poupança, comparador,
  política) fica em `apps/api/src/domain/`, sem Nest nem Prisma, 100% testável. O LLM nunca
  calcula — só conversa, e só no chat.
- **Dinheiro**: sempre em centavos (inteiro, nunca float). `apps/api/src/domain/money/centavos.ts`
  é o único lugar que decide o que conta como "inteiro".
- **Taxa de poupança** = `(receitas - despesas reais) / receitas` no mês. Aporte em investimento
  **não** é despesa. Transferência interna fica fora das métricas.
- **Auth de uso pessoal** (decisão de 2026-10-05: o app é só do dono, mas exige conta por segurança):
  uma conta criada por seed, **sem cadastro público**; senha com argon2; access token curto + refresh em
  cookie httpOnly. Todas as rotas exigem autenticação por padrão; só login e `/health` são `@Public()`.
  O isolamento por `userId` (feito na etapa 1 da spec `06-multiusuario`, hoje obsoleta) fica como defesa
  em profundidade. Motivo do cancelamento do multiusuário: o Meu Pluggy é gratuito só para uso pessoal; o
  plano de produção do Pluggy para outras pessoas começa em R$ 2.500/mês.
- **Nada concreto para uma pessoa só**: Caixinhas, percentuais, regras de categoria, convenção de
  rendimento e tabelas de imposto são dados editáveis; o código só sabe _como calcular_.
- **Banco (Supabase)**: `DATABASE_URL` é o transaction pooler (6543,
  `?pgbouncer=true&connection_limit=1`); `DIRECT_URL` é o session pooler (5432), usado pelo Prisma
  Migrate. O Prisma conecta como role `postgres` (ignora RLS). Toda migration que cria tabela faz
  `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL` em `anon`/`authenticated`, **sem** criar policies. A
  Data API do Supabase não é usada.
- **Cron**: sem `@nestjs/schedule` (o web service free dorme). O sync diário é um endpoint
  `POST /sync`, protegido por `SYNC_CRON_TOKEN`, chamado por um Render Cron Job ou GitHub Actions
  externo.
- **Posições de investimento**: ver "Achado do spike" abaixo — saldo manual por Caixinha, não
  sync automático.

## Achado do spike (2026-10-02)

Conectei o Meu Pluggy (conector `MeuPluggy`, item só em modo sandbox/contas de teste) e comparei
contra o app do Nubank:

- **Conta corrente (R$ 45,45) e cartão (R$ 94,92) batem exatamente** — esses dois ficam no sync
  automático do Pluggy sem ressalva.
- **Investimentos não batem.** O Nubank mostra 4 Caixinhas somando R$ 6.832,75 (Turbo 5.439,66; LL
  1.018,91; Investimentos 374,18; Gastos 0). O Pluggy devolveu só 13 lotes de CDB/RDB somando
  R$ 1.653,43 — **~76% do saldo real ausente**.
- Causas identificadas: (1) cada registro do Pluggy é um **lote individual** de CDB/RDB — não
  existe campo que agrupe por Caixinha (Turbo/LL/Investimentos/Gastos); (2) os lotes retornados
  cobrem só jan–jul/2025, sem nenhum dos últimos ~15 meses — sinal de sincronização inicial
  incompleta, não de campo errado (o campo `balance`/`amountWithdrawal` usado é o valor líquido
  correto por lote); (3) o item foi conectado via conector **MeuPluggy** (meu.pluggy.ai, o app
  consumidor do próprio Pluggy), não um conector "Nubank" direto — uma camada extra que pode não
  refletir o estado mais recente em tempo real.
- **Decisão**: posições de investimento usam **saldo manual por Caixinha**, com rendimento
  calculado (115% do CDI, via API do Banco Central). Os lotes do Pluggy entram só como **dado
  auxiliar** (cruzamento, não fonte de verdade) — detalhe na spec `02-sync-pluggy` quando ela for
  escrita.
- Dados crus do spike ficam em `spike-output/` (gitignored, nunca comitar — são dados reais da
  minha conta).

## Fases

1. **Fundação** — auth, sync (conta corrente + cartão), categorização por regras, taxa de
   poupança.
2. **Investimentos** — carteira (saldo manual por Caixinha), comparador líquido, reserva,
   envelopes.
3. **Disciplina** — política de gasto, assinaturas, digest por push.
4. **Extras** — simulador, IR, chat com LLM.

Mapa de specs e status real: `docs/specs/INDEX.md`.
