# Spec: Reserva de emergência

> Status: **✅ implementada** (2026-10-06) — aprovada pelo humano na mesma data (base de gasto **bruta**; **Caixinhas
> marcadas** como reserva; suposições aceitas). Migration aplicada no Supabase e verificada contra a API real. Requisito original do produto: _"Reserva de emergência calculada pelos meus gastos reais
> (média de gastos × meses definidos na minha política)"_.

## Objetivo

Responder "**quantos meses eu aguento hoje, e quanto falta para a minha meta?**": o Solidus calcula o gasto mensal
médio real, multiplica pelos meses de reserva que o usuário definiu e compara com o saldo das Caixinhas que ele
marcou como reserva de emergência.

## Cuidado com o nome

A "reserva" da spec 05 (`Caixinha.reservaDeGastos`) é o dinheiro para **gastar no mês** (a Caixinha Gastos). A reserva
de **emergência** é outra coisa e se chama `reservaEmergencia` em todo lugar (campo, rota, tipos), para nunca se
confundirem. Uma Caixinha **não pode ser as duas** (ver "Erros").

## Stack

Padrão da casa. **Sem dependência nem variável de ambiente nova.** O módulo novo `reserva` consome `PoupancaService`
(gasto por mês) e `CarteiraService` (saldo por Caixinha), então os dois módulos passam a **exportar** o serviço.

## Comportamento esperado

### 1. O gasto mensal médio (a base é do humano: bruta)

- Janela: as **`janelaMeses` (padrão 6) últimos meses FECHADOS** (o mês corrente fica de fora: está incompleto), em
  calendário UTC.
- Por mês, duas medidas, **ambas já existentes na poupança** (spec 04 e 07), sem cálculo novo de Pix:
  - **líquido** = `despesasCentavos` (Pix recebido de pessoas abate despesa, até o limite);
  - **bruto** = `despesasCentavos + pixPessoas.abatimentoCentavos` (**sem creditar** o Pix recebido).
    Decisão do humano (2026-10-06): a **base padrão é a bruta**, porque reserva de emergência é um número em que
    é melhor errar para cima, e a classificação do Pix só fica confiável com o front.
- Só entram os meses **a partir do primeiro que tem alguma transação** (mês anterior ao início dos dados não é
  "mês sem gasto"). Menos meses que a janela → aviso `HISTORICO_CURTO` (a média usa o que existe).
- **Média = soma ÷ meses considerados, arredondada PARA CIMA** (conservador), em centavos inteiros
  (`⌊(soma + n − 1) / n⌋`), nunca com ponto flutuante.
- As duas médias (`mediaMensalBrutaCentavos`, `mediaMensalLiquidaCentavos`) saem sempre na resposta; a **meta usa a
  da base configurada**, então trocar de base depois é mudar uma configuração, não refazer.
- Sem nenhum mês considerado, ou média zero → `SEM_GASTOS_NA_JANELA`, meta `0`, cobertura `null`.

### 2. A meta e o saldo da reserva

- **Meta** = `mediaMensal × meses` (`meses` padrão **6**, editável).
- **Saldo da reserva** = soma, entre as Caixinhas **ativas com `reservaEmergencia = true`**, do **saldo líquido
  estimado** (depois de IR e IOF: o que o usuário teria se resgatasse); se o líquido é `null` (tabelas de imposto
  vazias), usa o **bruto** daquela Caixinha com o aviso `IMPOSTO_NAO_CONFIGURADO`. Avisos da carteira
  (`CDI_DEFASADO`, `SEM_SALDO_INFORMADO`) das Caixinhas marcadas são repassados.
- **Cobertura** = `⌊saldo × 100 ÷ mediaMensal⌋` em **centésimos de mês** (`450` = 4,50 meses); `null` sem gasto.
- **Falta** = `max(0, meta − saldo)`; **atingida** = `meta > 0 && saldo ≥ meta`.
- Nenhuma Caixinha marcada → saldo `0` e aviso `NENHUMA_CAIXINHA_MARCADA` (em vez de um número enganoso).

### 3. Configuração

`PATCH /reserva-emergencia/configuracao` altera `meses` (1 a 60), `base` (`BRUTA` | `LIQUIDA`) e `janelaMeses`
(1 a 24), parcialmente. Sem registro, vale o padrão (`6`, `BRUTA`, `6`) e `GET` funciona; o `PATCH` cria o registro.

### 4. Marcar a Caixinha

`reservaEmergencia` entra em `POST /caixinhas`, `PATCH /caixinhas/:id` e nas respostas de Caixinha e da carteira
(campo **aditivo**). Marcar uma Caixinha que já é `reservaDeGastos` (ou o contrário) → erro (ver abaixo).

## Requisitos de saída

Tudo autenticado (`Authorization: Bearer`); nenhuma rota `@Public()`; dono = usuário da sessão (`@UserId()`).

| Rota                                       | Corpo                                                     | Sucesso                             | Erros                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /reserva-emergencia`                  | —                                                         | **200** `ReservaEmergenciaResponse` | **401**                                                                                                                  |
| `PATCH /reserva-emergencia/configuracao`   | subconjunto de `{ meses, base, janelaMeses }` (≥ 1 campo) | **200** `ConfiguracaoReserva`       | **400** (fora da faixa, não inteiro, `base` desconhecida, corpo vazio, campo extra) · **401**                            |
| `POST /caixinhas` · `PATCH /caixinhas/:id` | + `reservaEmergencia?: boolean`                           | como hoje                           | **400** `reservaEmergencia` não booleano (texto `"false"` nunca vira `true`) · **400** `CAIXINHA_RESERVAS_INCOMPATIVEIS` |

```ts
type BaseGastoReserva = 'BRUTA' | 'LIQUIDA';
type AvisoReserva =
  | 'NENHUMA_CAIXINHA_MARCADA'
  | 'SEM_GASTOS_NA_JANELA'
  | 'HISTORICO_CURTO'
  | 'IMPOSTO_NAO_CONFIGURADO'
  | 'CDI_DEFASADO'
  | 'SEM_SALDO_INFORMADO';

interface ConfiguracaoReserva {
  meses: number;
  base: BaseGastoReserva;
  janelaMeses: number;
}

interface ReservaEmergenciaResponse {
  configuracao: ConfiguracaoReserva;
  gasto: {
    base: BaseGastoReserva; // a usada na meta
    meses: { mes: string; brutoCentavos: number; liquidoCentavos: number }[]; // `YYYY-MM`, do mais antigo ao mais recente
    mediaMensalBrutaCentavos: number;
    mediaMensalLiquidaCentavos: number;
    mediaMensalCentavos: number; // a da base configurada
  };
  metaCentavos: number;
  reserva: {
    saldoCentavos: number;
    caixinhas: {
      id: string;
      nome: string;
      saldoCentavos: number;
      baseDoSaldo: 'LIQUIDO_ESTIMADO' | 'BRUTO_ESTIMADO';
    }[];
  };
  faltaCentavos: number;
  coberturaMesesCentesimos: number | null; // 450 = 4,50 meses
  atingida: boolean;
  avisos: AvisoReserva[];
  /** Data de referência do saldo, `YYYY-MM-DD` (UTC). */
  data: string;
}
```

Todo valor em **centavos inteiros**; nenhum `float` no contrato.

## Modelo de dados

**Aditivo** (nada removido, nenhum tipo alterado; a coluna nova tem `DEFAULT`, então não exige reescrever linhas):

```prisma
model Caixinha { /* ... */ reservaEmergencia Boolean @default(false) }

enum BaseGastoReserva { BRUTA LIQUIDA }

model ConfiguracaoReserva {
  id          String           @id @default(uuid())
  userId      String           @unique
  user        User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  meses       Int              @default(6)
  base        BaseGastoReserva @default(BRUTA)
  janelaMeses Int              @default(6)
  atualizadoEm DateTime        @updatedAt
}
```

`ConfiguracaoReserva` é tabela nova: leva `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL ... FROM anon, authenticated`, sem
policy, **na mesma migration que a cria** (lição da spec 07). `pnpm db:check-rls` precisa passar. O model entra em
`MODELOS_DO_USUARIO` da varredura `isolamento.spec.ts`. A migration é gerada **offline** (`prisma migrate diff`) e só é
aplicada no Supabase com o "sim" do humano, com `migrate deploy` (nunca `migrate dev`).

## Contrato compartilhado

`packages/shared/src/reserva.ts` (os tipos acima). Em `carteira.ts`, **aditivo**: `reservaEmergencia: boolean` em
`Caixinha`, `CaixinhaNaCarteira`, `CriarCaixinhaRequest` (opcional) e `AtualizarCaixinhaRequest` (opcional).

## Regra de negócio e dinheiro

Em `apps/api/src/domain/reserva/`, pura, sem Nest nem Prisma, **centavos inteiros, sem float** (`RULES.md` §2):
`calcularReserva(meses, saldos, configuracao)` (média com teto, meta, falta, cobertura, atingida, avisos). Jest no
mesmo commit, com teste de propriedade (resultados inteiros, `falta + min(saldo, meta) = meta`) e as bordas.

## Critérios de aceite (testáveis, em BDD)

- [ ] **Dado** 6 meses fechados com despesas brutas conhecidas, **quando** `GET /reserva-emergencia`, **então**
      `mediaMensalBrutaCentavos` é a soma ÷ 6 **arredondada para cima** (ex.: soma `1000001` em 6 meses → `166667`).
- [ ] **Dado** o mês corrente com despesas, **então** ele **não** entra na média (só meses fechados).
- [ ] **Dado** meses com Pix recebido de pessoas, **então** `brutoCentavos = despesasCentavos + abatimentoCentavos`
      de cada mês e `liquidoCentavos = despesasCentavos` (iguais à poupança), e `mediaMensalCentavos` é a da base
      configurada (padrão `BRUTA`).
- [ ] **Dado** só 3 meses com transação na janela de 6, **então** a média usa 3 e vem `HISTORICO_CURTO`; meses
      **anteriores** ao primeiro com dados não contam como "mês sem gasto".
- [ ] **Dado** nenhuma despesa na janela, **então** `SEM_GASTOS_NA_JANELA`, `metaCentavos: 0`,
      `coberturaMesesCentesimos: null` e `atingida: false`.
- [ ] **Dado** média `M` e `meses = 6`, **então** `metaCentavos = M × 6`; com `PATCH` para `meses = 3`, `M × 3`.
- [ ] **Dado** duas Caixinhas ativas marcadas (saldos líquidos `A` e `B`) e uma **não** marcada, **então**
      `reserva.saldoCentavos = A + B`, só as marcadas aparecem em `reserva.caixinhas` com `baseDoSaldo:
"LIQUIDO_ESTIMADO"`.
- [ ] **Dado** uma Caixinha marcada e **inativa**, **então** ela **não** entra no saldo.
- [ ] **Dado** tabelas de imposto vazias, **então** o saldo usa o bruto daquela Caixinha (`baseDoSaldo:
"BRUTO_ESTIMADO"`) e vem `IMPOSTO_NAO_CONFIGURADO`.
- [ ] **Dado** nenhuma Caixinha marcada, **então** saldo `0`, `NENHUMA_CAIXINHA_MARCADA` e `coberturaMesesCentesimos: 0`.
- [ ] **Dado** saldo `450000` e média `100000`, **então** `coberturaMesesCentesimos: 450`; com meta `600000`,
      `faltaCentavos: 150000` e `atingida: false`; com saldo `600000`, `faltaCentavos: 0` e `atingida: true`.
- [ ] **Dado** `PATCH /reserva-emergencia/configuracao`, **então** válido → `200` e persiste; `meses` `0`/`61`/`1.5`,
      `janelaMeses` `0`/`25`, `base` `"OUTRA"`, corpo `{}` ou campo extra → `400`; o `GET` seguinte reflete a mudança.
- [ ] **Dado** `POST/PATCH /caixinhas` com `reservaEmergencia: "false"` (texto) ou `1`, **então** `400`; com `true`,
      a Caixinha sai marcada e `GET /carteira` traz `reservaEmergencia: true`.
- [ ] **Dado** uma Caixinha `reservaDeGastos: true`, **quando** `PATCH` com `reservaEmergencia: true` (e o inverso),
      **então** `400 CAIXINHA_RESERVAS_INCOMPATIVEIS` e nada muda.
- [ ] **Dado** o usuário B, **então** nunca vê configuração nem Caixinhas do A (`404`/lista vazia) — isolamento.
- [ ] **Dado** qualquer rota nova **sem access token**, **então** `401`.
- [ ] **Dado** as migrations, **então** `pnpm db:check-rls` passa.
- [ ] **Dado** 200 entradas aleatórias, **então** todo número de saída é inteiro e `falta` nunca é negativa.

## Plano de testes

- **Unitário (Jest, `domain/reserva/`):** média com teto (bordas `soma % n`), meta, cobertura, falta, atingida, avisos,
  janela com histórico curto, teste de propriedade. Fixtures **sintéticas** (nunca números do spike).
- **Serviço/e2e (Jest, Prisma mockado):** composição com a poupança e a carteira, Caixinha marcada/inativa, DTOs
  (400/401/404), `"false"` nunca vira `true`, incompatibilidade das reservas, isolamento entre usuários.
- **Real (uma vez, no fim):** com a API local, `PATCH /caixinhas/:id { reservaEmergencia: true }` numa Caixinha de teste
  e `GET /reserva-emergencia` conferindo as médias contra `/poupanca/historico` do mesmo período.

Loop por tarefa: `pnpm --filter @solidus/api typecheck` → `pnpm --filter @solidus/api test` → `pnpm lint` →
`pnpm build`.

## Pendências de execução

- [x] **Migration** `20261006160000_reserva_emergencia` aplicada no Supabase remoto (2026-10-06) com `migrate deploy`;
      `pnpm db:check-rls` passou, com o RLS no mesmo arquivo (sem janela sem RLS).
- [x] **Verificação real:** 32/32 contra a API local. As médias da API batem com um **recálculo independente** feito a partir
      de `/poupanca/historico`: bruta R$ 3.813,20 (`381320` = `381320`) e líquida R$ 1.268,56 (`126856` = `126856`), com os
      6 meses fechados de abril a setembro e **sem o mês corrente**; meta de 6× = R$ 22.879,20. Com uma Caixinha de teste de
      R$ 4.503,61 marcada: cobertura `118` (1,18 mês), falta R$ 18.375,59, não atingida; a Caixinha não marcada (R$ 9.999) e
      a inativa ficam fora do saldo. `400 CAIXINHA_RESERVAS_INCOMPATIVEIS` nos dois sentidos; `reservaEmergencia` como
      `"false"`, `"true"`, `1` ou `null` → 400; configuração com 10 variantes inválidas → 400; `meses = 3` e base `LIQUIDA`
      refletem na meta; janela de 24 meses usa os 12 que existem e avisa `HISTORICO_CURTO`. As Caixinhas de teste foram
      apagadas e a configuração voltou aos padrões.
- [x] **Testes:** 777 no total (41 suítes), 31 do domínio com teste de propriedade, 14 mutantes mortos.

(além da spec)

- A migration leva o RLS **no mesmo arquivo** que cria a tabela (lição da spec 07).
- `reservaEmergencia` usa `@ValidateIf` (e não `@IsOptional`) para que `null` seja 400. Os campos antigos (`nome`, `percentualCdiBp`,
  `reservaDeGastos`, `ativa`; e `padrao`, `categoria`, `prioridade` das regras) tinham o mesmo defeito (500 num `PATCH`):
  **corrigido em 2026-10-06 num `/fix-bug` separado** (ver `ARCHITECTURE.md` §4.2).

## Fora de escopo

- **Política de investimento completa** (alocação, onde aportar): spec própria; ela reaproveitará `ConfiguracaoReserva`.
- **Separar gasto essencial do supérfluo** (a média usa todas as despesas reais).
- **Alertas/notificações** (e-mail, push) quando a reserva cair ou for atingida.
- Corrigir o número com **inflação**, **dívidas** ou **renda variável**.
- Front-end (barra de progresso da meta etc.).
- Processo: rodar a migration, atualizar `ARCHITECTURE.md` e o `INDEX.md`.

## Notas de ambiente

Sem variável nem dependência nova. `PoupancaModule` e `CarteiraModule` passam a exportar seus serviços.

## Suposições (assumidas por padrão; ajuste na revisão)

- **Janela de 6 meses fechados** e **6 meses de reserva** como padrões (editáveis, faixas 1–24 e 1–60).
- **Média arredondada para cima** (erra para o lado seguro, coerente com a base bruta).
- O saldo conta pelo **valor líquido estimado** (depois de IR/IOF), com o bruto como alternativa avisada.
- **Todas as despesas contam**, sem separar essencial de supérfluo; transferências internas, aportes e fatura de cartão
  ficam fora (já são neutros na taxa de poupança).
- Uma Caixinha **não** pode ser reserva de gastos e reserva de emergência ao mesmo tempo (erro 400).
- `ConfiguracaoReserva` é uma tabela própria e pequena; a política completa (spec futura) pode absorvê-la.
- Nome do arquivo sem número (`reserva-emergencia.md`), como o pedido do comando.

## Questões em aberto

- [x] Nenhuma bloqueante. As duas decisões de domínio (base **bruta**; **Caixinhas marcadas**) foram do humano em
      2026-10-06; as demais são as suposições acima.
