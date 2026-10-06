# Spec: Aviso de conexão do Pluggy caída, expirando ou desatualizada

> Status: **✅ implementada** (2026-10-06) — aprovada pelo humano na mesma data (opção A, só pela API). Migration aplicada
> no Supabase remoto e verificada contra a API e o item reais (ver "Pendências de execução").
> Requisito original do produto (`docs/produto.md`: "o consentimento tem prazo e precisa ser renovado; o app
> deve detectar a conexão caída ou expirada e me avisar"), até aqui **não implementado**.

## Objetivo

Hoje, se o consentimento do Meu Pluggy expirar, o login cair ou o sync parar de rodar, o Solidus continua
"funcionando" com dado velho e **não avisa**. Esta feature faz o app saber o estado da conexão e dizê-lo
ao usuário (por API, para o front mostrar como faixa), antes de ele tomar decisão em cima de número antigo.

## Stack

Padrão da casa, **sem dependência nova** (`pluggy-sdk` já está instalado) **e sem variável de ambiente
nova**. Canal do aviso: **só pela API** (decisão do humano, 2026-10-05, opção A). E-mail e Web Push ficam
fora; o push (Fase 3) reaproveitará o estado guardado aqui.

## Regra que molda o desenho

O Solidus é **somente leitura** (`RULES.md` §1). Ler o item do Pluggy (`fetchItem`) é leitura e cabe.
**Pedir ao Pluggy para atualizar ou reautorizar o item é escrita e é proibido.** Quem reconecta é o
usuário, no meu.pluggy.ai; o Solidus só **avisa e indica a ação**.

## Comportamento esperado

### 1. Ler o estado do item a cada sync

- Todo `POST /sync` lê o item (`PLUGGY_ITEM_ID`) **antes** de listar contas e grava um **retrato** do estado
  em `ConexaoPluggy` (uma linha por usuário): `status` e `executionStatus` do Pluggy, `consentExpiresAt`,
  `lastUpdatedAt`, `nextAutoSyncAt`, `autoSyncDisabledAt`, `consecutiveFailedLoginAttempts`, se há
  `userAction` pendente (só um booleano) e `verificadoEm` (quando o Solidus leu com sucesso).
- **Só códigos e datas**, nunca texto livre do Pluggy: `error`, `statusDetail` e o conteúdo de `userAction`
  podem carregar mensagem do banco ou link de autorização e **não são gravados nem devolvidos**.
- Se a leitura do item falhar (Pluggy fora do ar): o sync **continua** (a listagem pode funcionar ou falhar
  por conta própria), o retrato **mantém os valores anteriores** e grava `erroVerificacao = 'PLUGGY_INDISPONIVEL'`.
  Na próxima leitura bem-sucedida o erro é limpo.

### 2. Avaliar o retrato (regra pura, em `domain/conexao/`)

`avaliarConexao(retrato, agora)` devolve a lista de **avisos** e a **situação** (`OK` < `ATENCAO` < `CRITICO`,
o pior aviso manda). Datas por **dia (UTC)**, aritmética em inteiros:

| Aviso (`codigo`)                | Quando                                                                                              | Severidade  |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| `CONSENTIMENTO_EXPIRADO`        | `consentExpiresAt` já passou                                                                        | CRITICO     |
| `CONSENTIMENTO_EXPIRA_EM_BREVE` | faltam ≤ 7 dias → CRITICO; faltam de 8 a 30 dias → ATENCAO (31+ não avisa)                          | ver ao lado |
| `CONEXAO_PRECISA_DE_VOCE`       | `status` ∈ {`LOGIN_ERROR`, `WAITING_USER_INPUT`, `WAITING_USER_ACTION`} ou `userAction`             | CRITICO     |
| `ULTIMA_ATUALIZACAO_FALHOU`     | `status = OUTDATED` (a última execução falhou, pode tentar de novo)                                 | ATENCAO     |
| `AUTO_SYNC_DESATIVADO`          | `autoSyncDisabledAt` preenchido (o Pluggy parou de atualizar sozinho)                               | CRITICO     |
| `DADOS_DESATUALIZADOS`          | `lastUpdatedAt` há **mais de 2 dias** → ATENCAO; **mais de 7** → CRITICO                            | ver ao lado |
| `SYNC_DO_SOLIDUS_PARADO`        | `verificadoEm` há **mais de 2 dias** → ATENCAO; **mais de 7** → CRITICO (cobre o cron que não roda) | ver ao lado |
| `PLUGGY_INDISPONIVEL`           | `erroVerificacao` preenchido (a última tentativa de ler o item falhou)                              | ATENCAO     |
| `NUNCA_SINCRONIZADO`            | não existe retrato (nenhum sync leu o item ainda)                                                   | ATENCAO     |

`UPDATING` e `MERGING` (em andamento) não geram aviso. Cada aviso carrega uma **ação sugerida**
(`REAUTORIZAR_NO_MEU_PLUGGY` para consentimento, login e ação pendente; `VERIFICAR_AGENDADOR_DO_SYNC` para
sync parado; `null` nos demais). O texto e o link ficam com o front.

### 3. Expor

- `GET /conexao` devolve o retrato (sem `itemId`) e a avaliação. **Não chama o Pluggy**: lê o que o último sync
  gravou (o dado é D+1 e a rota será consultada a cada abertura do app).
- Sem retrato: `200` com `conexao: null`, `situacao: 'ATENCAO'` e o aviso `NUNCA_SINCRONIZADO` (não é erro).

## Requisitos de saída

Tudo autenticado (`Authorization: Bearer`); nenhuma rota `@Public()`. **Nenhuma rota de escrita**: o
retrato só é alterado pelo sync.

| Rota           | Sucesso                            | Erros             |
| -------------- | ---------------------------------- | ----------------- |
| `GET /conexao` | **200** `ConexaoResponse` (abaixo) | **401** sem token |

```ts
type SituacaoConexao = 'OK' | 'ATENCAO' | 'CRITICO';
type SeveridadeAviso = 'ATENCAO' | 'CRITICO';
type CodigoAvisoConexao =
  | 'CONSENTIMENTO_EXPIRADO'
  | 'CONSENTIMENTO_EXPIRA_EM_BREVE'
  | 'CONEXAO_PRECISA_DE_VOCE'
  | 'ULTIMA_ATUALIZACAO_FALHOU'
  | 'AUTO_SYNC_DESATIVADO'
  | 'DADOS_DESATUALIZADOS'
  | 'SYNC_DO_SOLIDUS_PARADO'
  | 'PLUGGY_INDISPONIVEL'
  | 'NUNCA_SINCRONIZADO';
type AcaoSugerida = 'REAUTORIZAR_NO_MEU_PLUGGY' | 'VERIFICAR_AGENDADOR_DO_SYNC' | null;

interface AvisoConexao {
  codigo: CodigoAvisoConexao;
  severidade: SeveridadeAviso;
  acao: AcaoSugerida;
  /** Dias inteiros que dão contexto (dias para expirar, dias sem atualizar); null quando não se aplica. */
  dias: number | null;
}

interface ConexaoResponse {
  situacao: SituacaoConexao;
  avisos: AvisoConexao[]; // do mais grave para o menos grave
  conexao: {
    status: string | null; // status do Pluggy (ex.: UPDATED, LOGIN_ERROR)
    consentimentoExpiraEm: string | null; // ISO 8601
    ultimaAtualizacaoEm: string | null; // lastUpdatedAt do Pluggy
    verificadoEm: string | null; // última leitura bem-sucedida pelo Solidus
  } | null;
  calculadoEm: string; // ISO 8601: o "agora" da avaliação
}
```

## Modelo de dados

**Aditivo** (uma tabela nova; nenhum campo existente muda). Leva `ENABLE ROW LEVEL SECURITY` +
`REVOKE ALL ... FROM anon, authenticated`, sem policy; `pnpm db:check-rls` precisa passar (`RULES.md` §6).
**Uma migration só, com o RLS no mesmo arquivo** (decisão de implementação: a ideia de uma migration separada
não evita o problema da spec 07, em que a tabela ficou ~1 min sem RLS entre as duas; no mesmo arquivo não existe janela).

```prisma
model ConexaoPluggy {
  id                       String    @id @default(uuid())
  userId                   String    @unique
  user                     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  itemId                   String    @db.VarChar(64)
  statusItem               String?   @db.VarChar(40)   // UPDATED, LOGIN_ERROR... (código do Pluggy)
  statusExecucao           String?   @db.VarChar(40)
  consentimentoExpiraEm    DateTime?
  ultimaAtualizacaoEm      DateTime?
  proximaAtualizacaoEm     DateTime?
  autoSyncDesativadoEm     DateTime?
  falhasDeLogin            Int?
  acaoPendente             Boolean   @default(false)   // só se há userAction, nunca o conteúdo
  verificadoEm             DateTime?
  erroVerificacao          String?   @db.VarChar(60)   // só o code, nunca a mensagem do Pluggy
  atualizadoEm             DateTime  @updatedAt
}
```

`User` ganha `conexaoPluggy ConexaoPluggy?`. O model entra em `MODELOS_DO_USUARIO` da varredura
`isolamento.spec.ts` (toda consulta filtra por `userId`).

## Contrato compartilhado

`packages/shared/src/conexao.ts`: `SituacaoConexao`, `SeveridadeAviso`, `CodigoAvisoConexao`,
`AcaoSugerida`, `AvisoConexao`, `ConexaoResponse` (acima). Rebuildar o shared antes da api.

## Regra de negócio e dinheiro

**Sem dinheiro.** A regra de avaliação (limites e severidades) vive em `apps/api/src/domain/conexao/`, pura,
sem Nest nem Prisma: `limites.ts` (30, 7, 2 e 7 dias, como constantes nomeadas) e `avaliar.ts`
(`avaliarConexao(retrato, agora)`, com o relógio **injetado** para o teste ser determinístico). Jest no
mesmo commit, com os limites exatos (7, 8, 30 e 31 dias; 2 e 7 dias de atraso).

## Critérios de aceite (testáveis, em BDD)

- [ ] **Dado** item `UPDATED`, consentimento a mais de 30 dias, atualizado há menos de 2 dias e verificado há
      menos de 2 dias, **quando** `GET /conexao`, **então** `situacao: "OK"` e `avisos: []`.
- [ ] **Dado** consentimento expirando em 30 dias, **então** `CONSENTIMENTO_EXPIRA_EM_BREVE` com
      `severidade: "ATENCAO"`; em 8 dias, o mesmo; em 7 dias, `"CRITICO"`; em 31 dias, nenhum aviso.
- [ ] **Dado** consentimento já vencido, **então** `CONSENTIMENTO_EXPIRADO` `CRITICO` e **não** também
      `CONSENTIMENTO_EXPIRA_EM_BREVE`; `acao: "REAUTORIZAR_NO_MEU_PLUGGY"`.
- [ ] **Dado** `status` `LOGIN_ERROR`, `WAITING_USER_INPUT` ou `WAITING_USER_ACTION`, **então**
      `CONEXAO_PRECISA_DE_VOCE` `CRITICO`; `OUTDATED` → `ULTIMA_ATUALIZACAO_FALHOU` `ATENCAO`;
      `UPDATING` e `MERGING` → nenhum aviso.
- [ ] **Dado** `autoSyncDisabledAt` preenchido, **então** `AUTO_SYNC_DESATIVADO` `CRITICO`.
- [ ] **Dado** `lastUpdatedAt` há 3 dias, **então** `DADOS_DESATUALIZADOS` `ATENCAO` com `dias: 3`; há 8 dias,
      `CRITICO`; há exatamente 2 dias, nenhum aviso.
- [ ] **Dado** `verificadoEm` há 3 dias (o cron não rodou), **então** `SYNC_DO_SOLIDUS_PARADO` `ATENCAO` com
      `acao: "VERIFICAR_AGENDADOR_DO_SYNC"`; há 8 dias, `CRITICO`.
- [ ] **Dado** vários avisos, **então** `situacao` é a **pior** severidade e `avisos` vêm do mais grave ao menos
      grave.
- [ ] **Dado** nenhum retrato gravado, **quando** `GET /conexao`, **então** `200`, `conexao: null`,
      `situacao: "ATENCAO"` e o aviso `NUNCA_SINCRONIZADO`.
- [ ] **Dado** um `POST /sync` com o item respondendo, **então** o retrato é gravado com `status`,
      `consentimentoExpiraEm`, `ultimaAtualizacaoEm` e `verificadoEm`, e **nenhuma coluna** guarda mensagem de
      erro, `statusDetail` ou conteúdo de `userAction`.
- [ ] **Dado** a leitura do item falhando (Pluggy fora), **então** o sync **não é abortado por isso**, o retrato
      mantém os valores anteriores, `erroVerificacao = "PLUGGY_INDISPONIVEL"` e `GET /conexao` traz o aviso
      `PLUGGY_INDISPONIVEL` `ATENCAO`.
- [ ] **Dado** o item que voltou a `UPDATED` e a leitura funcionando, **quando** o próximo sync roda, **então**
      `erroVerificacao` é limpo e os avisos correspondentes somem.
- [ ] **Dado** `GET /conexao` sem access token, **então** `401`; a resposta **nunca** contém `itemId`.
- [ ] **Dado** o usuário B autenticado, **quando** `GET /conexao`, **então** ele não vê o retrato do usuário A
      (`conexao: null`) — teste de isolamento do módulo.
- [ ] **Dado** o gateway do Pluggy, **então** o novo método é só de leitura (`listarItem`, que chama
      `fetchItem`) e os testes de guarda da spec 02 continuam passando (só `listar*`/`fetch*`).
- [ ] **Dado** as migrations, **então** `pnpm db:check-rls` passa com a tabela nova.

## Plano de testes

- **Unitário (Jest, `domain/conexao/`):** `avaliar.spec.ts` com a tabela de avisos inteira e os limites exatos
  (7/8/30/31 dias de consentimento; 2 e 7 dias de atraso; `UPDATING`/`MERGING` sem aviso; `situacao` = pior;
  ordenação; sem retrato). Fixtures **sintéticas**, nunca dado real do spike.
- **Serviço (Jest, Prisma e gateway mockados):** gravar o retrato no sync; falha da leitura mantém o anterior e
  não aborta o sync; limpar `erroVerificacao`; nada de texto livre do Pluggy chega ao `upsert`.
- **e2e (Jest):** `GET /conexao` com 200/401, sem `itemId`, isolamento entre usuários.
- **Real (uma vez, no fim):** com a API local, `POST /sync` e depois `GET /conexao` com o item real
  (esperado: `situacao: "OK"` e `consentimentoExpiraEm` em 2027).

Loop por tarefa: `pnpm --filter @solidus/api typecheck` → `pnpm --filter @solidus/api test` →
`pnpm lint` → `pnpm build`.

## Pendências de execução

- [x] **Migration** `20261006143000_aviso_conexao_pluggy` aplicada no Supabase remoto (2026-10-06) com `migrate deploy`;
      `pnpm db:check-rls` passou, **sem janela sem RLS** (tabela e RLS no mesmo arquivo).
- [x] **Verificação real** contra a API local e o item verdadeiro: `GET /conexao` sem retrato → `NUNCA_SINCRONIZADO`;
      depois de um `POST /sync` → `situacao: "OK"`, `status: "UPDATED"`, consentimento em 2027-10-02, `verificadoEm` de
      agora; um 2º sync atualiza o mesmo retrato; a resposta nunca contém o `itemId`; sem token → 401; os métodos
      de escrita não alteram nada. **Caminho do erro ao vivo:** com um item inexistente, o retrato anterior foi
      **mantido**, apareceu `PLUGGY_INDISPONIVEL` (ATENCAO) e o `itemId` falso não vazou; um sync normal em seguida
      limpou o erro (`situacao: "OK"`).
- [x] **Testes:** 676 no total (37 suítes), 37 do domínio nas bordas exatas, 12 mutantes mortos.

## Achados fora do escopo desta spec (para outra execução)

1. **`CatchAllController` devolve 200 vazio com login válido** para qualquer rota inexistente ou método errado
   (ex.: `GET /rota-que-nao-existe`, `DELETE /salario`); só sem login ele responde 401 como previsto. Não escreve nem
   vaza nada, mas esconde erro de rota de quem consome a API. O e2e desta spec não pegou porque o módulo de teste não
   inclui o `CatchAll`; por isso a prova de "não há escrita em `/conexao`" foi feita conferindo que o retrato **não
   muda**, e não pelo status 404.
2. **`POST /sync` com um `PLUGGY_ITEM_ID` inexistente responde 200 com 0 contas**, em silêncio. Antes desta spec nada
   avisaria; agora o aviso `PLUGGY_INDISPONIVEL` cobre o caso, mas o sync em si continua não sinalizando.

## Fora de escopo

- **Notificar** (e-mail, Web Push): a decisão foi só pela API; o push da Fase 3 reaproveita o retrato.
- **Reautorizar ou forçar atualização do item**: é escrita no Pluggy, proibida (`RULES.md` §1). O Solidus só avisa.
- A **faixa na tela** (front-end) e o texto/link de "como reconectar".
- **Agendar** o `POST /sync`: continua pendente (ADR 0005); esta spec só **detecta** que ele não está rodando.
- **Webhooks** do Pluggy (exigem URL pública) e **vários itens/conexões**.
- Processo: rodar a migration, atualizar `ARCHITECTURE.md` e o `INDEX.md`.

## Notas de ambiente

Sem variável nem dependência nova. O endpoint reaproveita o `PluggyGateway` existente (1 método de leitura
novo, `listarItem`).

## Suposições (assumidas por padrão; ajuste na revisão)

- **Limites:** consentimento avisa a **30 dias** (ATENCAO) e vira CRITICO a **7 dias**; dado velho é ATENCAO
  acima de **2 dias** (o Pluggy atualiza 1 vez por dia) e CRITICO acima de **7**; mesma régua para o sync do
  Solidus parado.
- **Só `GET /conexao`:** o front chama a rota ao abrir. Não adiciono `avisos` dentro de `/poupanca` nem de
  `/carteira` (evita mexer em contratos existentes).
- **Uma conexão por usuário** (hoje o item vem do `.env`); `userId` único na tabela.
- **Decisões de implementação:** (a) `lastUpdatedAt` nulo (nenhuma coleta registrada) vira `DADOS_DESATUALIZADOS`
  `ATENCAO` sem `dias`; (b) `verificadoEm` nulo não gera `SYNC_DO_SOLIDUS_PARADO` (a falha aparece como
  `PLUGGY_INDISPONIVEL`); (c) `AUTO_SYNC_DESATIVADO` e `ULTIMA_ATUALIZACAO_FALHOU` não têm ação sugerida (a spec só
  dava ação ao consentimento, ao login e ao sync parado); (d) o `PluggyGateway` foi movido para um `PluggyModule`
  (sem mudança de comportamento) para evitar dependência circular; (e) `autoSyncDisabledAt` existe na resposta real
  mas o SDK 0.91 não o tipa: é lido por uma forma estrutural no mapeador.
- `OUTDATED` é só ATENCAO (a execução falhou mas pode ser tentada de novo); login inválido e ação pendente
  são CRITICO.
- **Nome do arquivo** sem número (`aviso-conexao-pluggy.md`), como o pedido do comando; se preferir seguir a
  numeração (`08-...`), renomeio.

## Questões em aberto

- [x] Nenhuma bloqueante; suposições aprovadas em 2026-10-06.
