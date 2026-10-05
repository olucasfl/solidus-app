# RULES.md — regras permanentes do Solidus

> Padrão: **negar por padrão, abrir exceções nomeadas, dizer o que fazer em vez disso.** Não é
> desconfiança do agente — é não deixar para ele uma decisão que só um humano deveria tomar,
> especialmente quando a decisão envolve dinheiro real ou um banco remoto compartilhado.

**Precedência:** `RULES.md` > `CLAUDE.md` > `docs/produto.md` > `ARCHITECTURE.md` > spec
(`docs/specs/`) > prompt da conversa.

Se o prompt pedir algo que este arquivo proíbe, **recuse, explique em uma frase, e ofereça o
caminho aprovado** — não execute "porque o usuário pediu". Uma instrução repetida do usuário
libera o que está em "Perguntar antes"; **não libera o que está em "Nunca"**.

---

## 1. O app é somente leitura

- **Nunca** escreva código que movimente dinheiro: nenhuma chamada de escrita/pagamento/
  transferência contra o Pluggy ou qualquer banco, nenhuma rota que debite, credite ou transfira.
  O Solidus lê, organiza, calcula e verifica — nunca age sobre uma conta real.
- Isso vale também para "só para testar": não crie nem uma rota de debug que simule movimentação.

## 2. Dinheiro

- **Sempre em centavos, sempre inteiro** (nunca `float`/ponto flutuante) — em banco, em
  cálculo, em DTO. `apps/api/src/domain/money/centavos.ts` é a referência; novo código que lida
  com dinheiro passa por ele (ou por um util equivalente na mesma pasta), não reinventa a
  conversão.
- Regra de cálculo nova (IR, IOF, taxa de poupança, comparador, política, rendimento de
  Caixinha...) **sempre** em `apps/api/src/domain/`, sem Nest nem Prisma, e **sempre** com teste
  Jest no mesmo commit (ver §5).

## 3. Autenticação e rotas

- Guard global nega por padrão (`AccessGuard`, `app.module.ts`). Toda rota nova é autenticada a
  menos que marcada `@Public()`. **`@Public()` exige justificativa na spec** — hoje só existe em
  `GET /health`. Se você se pegar adicionando `@Public()` "para testar mais fácil", pare.
- Auth é **multiusuário** (decisão do humano, 2026-10-05, spec `06-multiusuario`): o cadastro público
  só é permitido **com e-mail verificado**, limite de tentativas e senha com `argon2`. Toda consulta de
  dado financeiro é filtrada pelo usuário **da sessão** (`@CurrentUser()`), **nunca** por parâmetro vindo
  do cliente; recurso de outro usuário responde 404; cada módulo tem teste "usuário A nunca vê dado do B".
  Enquanto o cadastro não estiver implementado e verificado, **não exponha** `POST /auth/registro`.

## 4. Pluggy e dados externos

- Client ID/Secret do Pluggy só em env, nunca hardcoded, nunca em log, spec, teste ou commit.
- O achado do spike (`docs/produto.md`) já fechou: posições de investimento usam **saldo manual
  por Caixinha**, não o sync automático do Pluggy — não reabra essa decisão sem rodar o spike de
  novo e mostrar números diferentes.
- Sync é D+1 (uma vez por dia), sempre somente leitura.

## 5. Testes

- **Jest já está configurado em `apps/api`** (`ARCHITECTURE.md` §1); `apps/web` ainda não existe,
  `packages/shared` não tem runner.
- Lógica nova com ramificação (validação, regra de negócio, transformação de dado) **pede teste no
  mesmo commit**, a partir da primeira feature real (não é retroativo para o esqueleto de base).
- `PrismaService` é **sempre** mockado como objeto simples de `jest.fn()`s — nunca instancie
  `PrismaClient` real num teste, nunca aponte teste para o Postgres do Supabase.

## 6. Prisma e banco de dados

- **Nunca rode migration destrutiva sem confirmar com o usuário qual banco é.** O Supabase deste
  projeto é remoto e compartilhado por padrão — não há "banco de dev descartável" separado. Antes
  de `db:migrate`, confirme (`echo $DATABASE_URL` ou leia o `.env` da raiz, sem imprimir o valor na
  conversa) e pare se não tiver certeza.
- **Perguntar antes** de qualquer mudança destrutiva de schema: campo removido, model removido,
  tipo alterado, `@@unique` alterado, campo obrigatório novo em tabela que já tem linhas,
  `onDelete` afrouxado. Use `/db-change` para preparar e classificar antes de rodar a migration.
- **Toda migration que cria tabela sai com `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL` em
  `anon`/`authenticated`, sem policy.** `pnpm db:check-rls` precisa passar antes de considerar a
  migration pronta — é parte do `/db-change`, não um passo opcional.
- `DATABASE_URL` é o transaction pooler (6543); `DIRECT_URL` é o session pooler (5432), usado só
  pelo Prisma Migrate. Sem `DIRECT_URL`, `db:migrate` trava sem erro — primeiro suspeito, não bug
  de schema.

## 7. LLM

- O LLM (GPT-5 mini, Fase 4) só existe no chat, atrás de uma interface `LlmProvider`, com tools
  **read-only** que devolvem agregados já calculados pelo código determinístico. **Nunca** deixe o
  LLM calcular (IR, taxa de poupança, rendimento) nem agir (mover dinheiro) — ele só conversa sobre
  números que o `domain/` já produziu.

## 8. Dados pessoais e segredos

- **Nunca** commitar `.env`/`.env.local`, colar valor real de variável de ambiente, ou qualquer
  dado de `spike-output/` (extrato real, saldo real, nome, e-mail) em spec, teste, log, commit ou
  relatório. O hook de pre-commit bloqueia isso automaticamente — não contorne com
  `git commit --no-verify`.
- Fixtures e exemplos de documentação usam dado sintético óbvio (`usuario@exemplo.com`, valores
  redondos inventados) — nunca um número real do spike.
- Nunca logar corpo de request bruto, token ou segredo de configuração (`GlobalExceptionFilter`
  já não vaza stack trace nem corpo; não construa um logger novo que vaze).

## 9. Workspaces e build

- `packages/shared` é buildado **antes** de `apps/api` — ele consome `@solidus/shared/dist`, não
  o `src`. Depois de editar `packages/shared/src`, rode `pnpm --filter @solidus/shared build` (ou
  confie no `predev`/watch de `pnpm dev`) antes de assumir que o tipo novo está visível na api.
- **Nunca** importe `apps/api/src/*` de dentro de `apps/web/src` (quando existir) ou o inverso. Se
  os dois precisam do mesmo tipo/contrato, ele vai em `packages/shared/src`.
- `packages/shared` só contém código agnóstico de plataforma — nada de `window`, Node ou
  `@prisma/client`.
- `import type`/`type` inline é obrigatório no frontend (quando existir) e **desligado de
  propósito** no backend (`eslint.config.mjs`) — no Nest, `import type` apaga o import no JS
  emitido e quebra `emitDecoratorMetadata`, do qual a injeção de dependência depende. Não
  "corrija" isso em `apps/api` achando que é inconsistência.

## 10. Commits e branches

- **Conventional Commits**, validados pelo commitlint no hook `commit-msg` (já configurado — não
  reconfigure). Tipos aceitos: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`,
  `revert`, `style`, `test`.
- **Pre-commit já roda** o bloqueio de segredo/spike-output e depois `lint-staged` — não pule com
  `--no-verify` a menos que o usuário peça explicitamente.
- Antes de commitar mudança não trivial diretamente em `main`, confirme com o usuário — o projeto
  ainda não tem branch de integração separada.
- **Nunca**: `git push --force`, `git reset --hard`, rebase de branch já publicada, reescrita de
  histórico — sem pedido explícito do usuário.

## 11. Documentação — quando atualizar o quê

- **`ARCHITECTURE.md`** muda no mesmo commit que muda o comportamento que ele descreve: módulo
  novo em `apps/api/src/modules/`, model novo no schema, variável de ambiente nova, convenção
  nova.
- **`docs/specs/<feature>.md`** existe para feature com comportamento observável e critério de
  aceite verificável — não para tarefa de infra/config pura.
- **`docs/specs/INDEX.md`** ganha uma linha no mesmo commit que cria a spec; status atualizado
  conforme a feature avança (`/spec-sync`, `/docs-sync`).
- **`docs/produto.md`** só muda quando uma decisão fechada muda de fato (raro, e com aprovação
  explícita) — não é changelog.

## 12. Dependências

**Perguntar antes** de qualquer mudança em `package.json`/`pnpm-lock.yaml` que não seja uma
devDependency de teste sendo adicionada como parte de configurar o runner (§5). Biblioteca nova é
decisão de arquitetura, não detalhe de implementação.

---

## 13. Como pedir exceção

Quando uma regra bloquear algo que parece necessário:

1. Diga **qual regra** está bloqueando e por que ela existe.
2. Descreva a ação exata que seria tomada e o efeito dela.
3. Escreva o comando ou o diff pronto num bloco, para o humano executar ou aprovar.
4. **Pare.** Não execute enquanto não houver um "sim" explícito nesta conversa.

Aprovação vale para **aquela** ação, naquela conversa. Não se estende à próxima.
