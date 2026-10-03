# Spec: Sync com o Pluggy (conta corrente e cartão)

> Status: implementada (2026-10-03) — **autoaprovada pelo agente sob delegação explícita do humano**
> ("pode ir decidindo", modo automático). Revisar as "Suposições" no fim antes de confiar.

## Objetivo

Trazer do Meu Pluggy, uma vez por dia, as contas (corrente/poupança e cartão) e as transações do
Lucas para o banco do Solidus, de forma idempotente e somente leitura — base de tudo que vem
depois (categorização, taxa de poupança).

## Stack

Padrão da casa, **sem dependência nova**: `pluggy-sdk` já está no `package.json`. O acesso ao SDK
fica atrás de uma interface própria (`PluggyGateway`) para o service ser testável com mock (nenhum
teste chama o Pluggy de verdade).

## Comportamento esperado

- `POST /sync` (chamado pelo cron externo, ADR 0005) lê contas e transações do item
  `PLUGGY_ITEM_ID` e grava no banco. **Somente leitura no Pluggy**: nenhuma chamada de escrita,
  nem `updateItem` (RULES §1); o Meu Pluggy atualiza o item por conta própria.
- **Autorização:** `@Public()` para o `AccessGuard` (não há usuário na chamada) **mas protegida por
  `SyncTokenGuard`**: header `x-sync-token` comparado com `SYNC_CRON_TOKEN` por comparação de tempo
  constante (`timingSafeEqual`). Sem header, header de tamanho/valor errado → 401 `SYNC_TOKEN_INVALIDO`
  (mesmo erro nos dois casos). Justificativa do `@Public()`: RULES §3 / ADR 0005.
- **Idempotente:** transação identificada por `pluggyTransactionId` (único); rodar duas vezes seguidas
  não duplica nada. Transação já existente só é **atualizada** se algo mudou (valor, status, descrição,
  categoria, data — ex.: `PENDING` → `POSTED`); `transacoesAtualizadas` conta só essas.
- **Janela:** primeiro sync (sem transações no banco) busca tudo. Os seguintes buscam
  `dateFrom = (data mais recente no banco) − 30 dias` (sobreposição para pegar pendentes que
  viram efetivadas e correções tardias).
- **Contas:** upsert por `pluggyAccountId`. Só tipos `BANK` (corrente/poupança) e `CREDIT` (cartão);
  outros são ignorados. `saldoCentavos` é o `balance` da conta no momento do sync.
- **Dinheiro:** sempre centavos inteiros (RULES §2), pela função de domínio
  `reaisParaCentavos` (arredonda para o centavo mais próximo; rejeita NaN/infinito).
- **Sinal (verificado com dados reais agregados em 2026-10-03):** a convenção do Pluggy **difere por
  tipo de conta** — na corrente `DEBIT` vem negativo; no cartão `DEBIT` (compra) vem **positivo** e
  `CREDIT` (pagamento/estorno) negativo. Por isso o sinal vem do `type`, nunca do valor cru:
  `DEBIT` → `valorCentavos` negativo (saída), `CREDIT` → positivo (entrada), sempre em módulo.
- **Moeda estrangeira:** o cartão tem transações em USD. Usa-se `amountInAccountCurrency` quando
  existir (valor já em BRL); se a moeda da transação não for BRL e esse campo for nulo, a transação
  é gravada com `valorCentavos` do `amount` cru e `moeda` ≠ `BRL`, e conta em `semConversao` na
  resposta (nunca silenciosamente tratada como BRL).
- **Concorrência:** um sync por vez (trava em memória). Segunda chamada durante um sync em andamento
  → 409 `SYNC_EM_ANDAMENTO`.
- **Falhas:** Pluggy fora do ar/erro de credencial → 502 `PLUGGY_INDISPONIVEL` (mensagem genérica,
  nunca o corpo do erro do Pluggy); `PLUGGY_ITEM_ID` vazio → 503 `PLUGGY_NAO_CONFIGURADO`. Toda
  execução (sucesso ou falha) grava uma linha em `SyncRun`. Falha no meio **não** desfaz o que já foi
  gravado (cada conta é gravada por inteiro e o próximo sync reconcilia por idempotência).
- **Fora o essencial, nada é logado:** nem descrição, nem valor, nem nome de conta (RULES §8).
- `GET /sync/status` (autenticada, usuário) devolve o último `SyncRun` — para o futuro frontend e para
  conferência humana.

## Requisitos de saída

| Rota               | Auth                  | Sucesso                                                                                                                                  | Erros                                                                                                                |
| ------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `POST /sync`       | header `x-sync-token` | **200** `{ contas, transacoesNovas, transacoesAtualizadas, semConversao, duracaoMs }` (inteiros)                                         | 401 `SYNC_TOKEN_INVALIDO` · 409 `SYNC_EM_ANDAMENTO` · 502 `PLUGGY_INDISPONIVEL` · 503 `PLUGGY_NAO_CONFIGURADO` · 429 |
| `GET /sync/status` | Bearer (access token) | **200** `{ ultimoSync: null }` ou `{ ultimoSync: { iniciadoEm, finalizadoEm, status, contas, transacoesNovas, transacoesAtualizadas } }` | 401 (guard global)                                                                                                   |

`POST /sync` não tem corpo (não há DTO; qualquer corpo enviado é ignorado). Limite: 5/min por IP
(`@Throttle`).

## Modelo de dados

**Aditivo** (3 tabelas novas, nenhuma existente muda). Todas com RLS + `REVOKE ALL` (RULES §6).

```prisma
enum TipoConta { CORRENTE POUPANCA CARTAO }
enum TipoTransacao { DEBITO CREDITO }
enum StatusTransacao { PENDENTE EFETIVADA }
enum StatusSync { SUCESSO FALHA }

model Conta {
  id              String    @id @default(uuid())
  pluggyAccountId String    @unique
  tipo            TipoConta
  nome            String    @db.VarChar(120)
  saldoCentavos   Int
  moeda           String    @db.VarChar(3)
  atualizadoEm    DateTime  @updatedAt
  criadoEm        DateTime  @default(now())
  transacoes      Transacao[]
}

model Transacao {
  id                  String          @id @default(uuid())
  pluggyTransactionId String          @unique
  contaId             String
  conta               Conta           @relation(fields: [contaId], references: [id], onDelete: Cascade)
  data                DateTime
  descricao           String          @db.VarChar(500)
  valorCentavos       Int             // negativo = saída, positivo = entrada (ver "Sinal")
  tipo                TipoTransacao
  status              StatusTransacao
  moeda               String          @db.VarChar(3)
  categoriaPluggy     String?         @db.VarChar(120)  // dado auxiliar; a categoria do Solidus vem na spec 03
  criadoEm            DateTime        @default(now())
  atualizadoEm        DateTime        @updatedAt
  @@index([contaId, data])
  @@index([data])
}

model SyncRun {
  id                    String     @id @default(uuid())
  iniciadoEm            DateTime   @default(now())
  finalizadoEm          DateTime?
  status                StatusSync
  contas                Int        @default(0)
  transacoesNovas       Int        @default(0)
  transacoesAtualizadas Int        @default(0)
  erro                  String?    @db.VarChar(60) // só o code (ex. PLUGGY_INDISPONIVEL), nunca mensagem do Pluggy
}
```

`Int` em centavos comporta até ~R$ 21 milhões por valor — suficiente para finanças pessoais (suposição).

## Contrato compartilhado

`packages/shared/src/sync.ts`: `SyncResponse` e `SyncStatusResponse` (shapes acima) e
`SyncErrorCode = 'SYNC_TOKEN_INVALIDO' | 'SYNC_EM_ANDAMENTO' | 'PLUGGY_INDISPONIVEL' | 'PLUGGY_NAO_CONFIGURADO'`.

## Regra de negócio e dinheiro

Mapeamento Pluggy → centavos/sinal em `apps/api/src/domain/sync/` (puro, sem Nest/Prisma/SDK),
usando `reaisParaCentavos` novo em `domain/money/centavos.ts`. Teste Jest no mesmo commit.

## Critérios de aceite (testáveis, em BDD)

Testes automatizados usam `PluggyGateway` mockado e `PrismaService` mockado (nunca o Pluggy/banco
reais). Verificação real (`/qa-verify`) usa a API local com o item real, só leitura.

- [x] **CA-01** — **Dado** `reaisParaCentavos`, **quando** recebe `10.1`, `0.07`, `-5.55`, `1234.567`,
      **então** devolve `1010`, `7`, `-555`, `123457`; e lança erro para `NaN` e `Infinity`.
- [x] **CA-02** — **Dado** uma transação `DEBIT` com `amount` `-50.25` (corrente) **e** outra `DEBIT`
      com `amount` `50.25` (cartão), **quando** mapeadas, **então** ambas têm `valorCentavos = -5025`.
- [x] **CA-03** — **Dado** `CREDIT` com `amount` `100` (corrente) **e** `CREDIT` com `-100` (cartão),
      **então** ambas têm `valorCentavos = 10000`.
- [x] **CA-04** — **Dado** transação em USD com `amountInAccountCurrency` `52.10`, **então**
      `valorCentavos` usa `5210` e a transação **não** conta em `semConversao`; **dado** USD com
      `amountInAccountCurrency` nulo, **então** usa o `amount` cru, grava `moeda: "USD"` e conta
      em `semConversao`.
- [x] **CA-05** — **Dado** `status` `PENDING`/`POSTED`/ausente, **então** mapeia para
      `PENDENTE`/`EFETIVADA`/`EFETIVADA`.
- [x] **CA-06** — **Dado** banco sem transações, **quando** `POST /sync` com o token certo, **então**
      200, o gateway é chamado **sem** `dateFrom`, e `transacoesNovas` = total devolvido pelo gateway.
- [x] **CA-07** — **Dado** o mesmo conjunto de transações já gravado, **quando** `POST /sync` de novo,
      **então** 200 com `transacoesNovas: 0` e `transacoesAtualizadas: 0` (nada duplicado e nenhum
      update desnecessário); **dado** uma já gravada cujo `status` mudou de `PENDENTE` para `EFETIVADA`,
      **então** `transacoesAtualizadas: 1` e o registro é atualizado.
- [x] **CA-08** — **Dado** banco com a transação mais recente em `2026-09-20`, **quando** sincroniza,
      **então** o gateway é chamado com `dateFrom = 2026-08-21`.
- [x] **CA-09** — **Dado** `POST /sync` sem `x-sync-token`, com token de tamanho diferente, e com token
      de mesmo tamanho porém errado, **então** os três dão 401 `SYNC_TOKEN_INVALIDO` com o mesmo
      corpo, e o gateway **não** é chamado.
- [x] **CA-10** — **Dado** um sync em andamento, **quando** chega outro `POST /sync`, **então** 409
      `SYNC_EM_ANDAMENTO`.
- [x] **CA-11** — **Dado** o gateway lançando erro, **então** 502 `PLUGGY_INDISPONIVEL` com mensagem
      genérica (o texto do erro original não aparece na resposta), e existe um `SyncRun` com
      `status: FALHA` e `erro: "PLUGGY_INDISPONIVEL"`.
- [x] **CA-12** — **Dado** `PLUGGY_ITEM_ID` vazio, **então** 503 `PLUGGY_NAO_CONFIGURADO` e o gateway
      não é chamado.
- [x] **CA-13** — **Dado** contas `BANK/CHECKING_ACCOUNT`, `BANK/SAVINGS_ACCOUNT`, `CREDIT/CREDIT_CARD`
      e uma de tipo desconhecido, **então** mapeiam para `CORRENTE`, `POUPANCA`, `CARTAO` e a
      desconhecida é ignorada.
- [x] **CA-14** — **Dado** um sync com sucesso, **então** existe um `SyncRun` `SUCESSO` com os
      contadores iguais à resposta, e `GET /sync/status` (com access token) devolve esse registro;
      sem nenhum sync, devolve `{ ultimoSync: null }`; sem token → 401.
- [x] **CA-15** — **Dado** 6 chamadas de `POST /sync` com token válido em 1 min, **então** a 6ª é 429
      `LIMITE_TENTATIVAS`.
- [x] **CA-16** — **Dado** o código-fonte do módulo `sync`, **então** não há nenhuma chamada de
      escrita do SDK (`updateItem`, `createItem`, `deleteItem`, pagamentos) — verificado por teste
      que varre os métodos do `PluggyGateway`.
- [x] **CA-17** — **Dado** as migrations, **então** `pnpm db:check-rls` passa com as 3 tabelas novas.
- [x] **CA-18 (real)** — **Dado** a API local com o item real, **quando** `POST /sync` duas vezes
      seguidas, **então** a primeira grava contas+transações e a segunda tem `transacoesNovas: 0`;
      contagens agregadas no banco batem com o que o Pluggy devolveu (sem imprimir dados pessoais).

## Plano de testes

- **Unitário (Jest):** `domain/money/centavos.spec.ts` (acréscimo, CA-01) · `domain/sync/mapear.spec.ts`
  (CA-02 a CA-05, CA-13) · `sync.service.spec.ts` (CA-06 a CA-08, CA-10 a CA-12, CA-14, CA-16) ·
  `sync-token.guard.spec.ts` (CA-09).
- **E2E (supertest, Prisma e gateway mockados):** `sync.e2e.spec.ts` (CA-09 a CA-12, CA-14, CA-15).
- **Real:** CA-17 e CA-18 contra o Supabase e o Pluggy reais, só leitura.

Loop: `pnpm --filter @solidus/api typecheck` → `test` → `pnpm lint` → `pnpm build` → commit.

## Fora de escopo

- Investimentos (ADR 0006), categorização do Solidus (spec 03), qualquer cálculo de poupança (04).
- Detectar transferência interna / pagamento de fatura (spec 03/04 decidem).
- Agendador em si (Render Cron/GitHub Actions) e deploy: passo de processo do humano.
- Forçar refresh do item no Pluggy (`updateItem` é escrita; vedado pela RULES §1).
- Fatura do cartão (`creditCardBills`) e limite do cartão.
- Passo de processo: rodar a migration; atualizar `ARCHITECTURE.md` e `INDEX.md`.

## Notas de ambiente

Sem variável nova: `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_ITEM_ID`, `SYNC_CRON_TOKEN` já
existem em `env.validation.ts` (esta última com ≥ 32 caracteres). Sem dependência nova.

## Questões em aberto

Nenhuma bloqueante (decisões tomadas pelo agente, listadas abaixo).

## Suposições

- Sinal pelo `type` (verificado com contagens agregadas reais: corrente assinada, cartão invertido).
- `amountInAccountCurrency` é o valor já convertido para BRL quando a moeda é estrangeira.
- Janela incremental de 30 dias de sobreposição.
- `Int` de centavos basta (teto ~R$ 21 mi por lançamento).
- Poupança entra como tipo próprio (`POUPANCA`) caso apareça; hoje o item só tem corrente e cartão.
- `balance` do cartão é gravado cru, sem interpretar (fatura/limite ficam para spec futura).
- Trava de concorrência em memória basta (uma instância; se escalar, vira lock no banco).
