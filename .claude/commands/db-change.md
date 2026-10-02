---
description: Prepara uma mudança de schema Prisma — classifica o risco, edita o schema, aplica RLS e gera a migration localmente
argument-hint: <descrição da mudança>
---

Prepare a mudança de schema: **$ARGUMENTS**

## Por que este comando existe

O Solidus usa `prisma migrate dev` — schema versionado, com histórico em
`apps/api/prisma/migrations/`. `migrate dev` pode pedir para resetar o banco quando detecta drift,
e esse "banco" é o **Supabase de produção/único** deste projeto — não há banco de dev separado e
descartável. Por isso o agente **prepara e classifica**; a execução que pode resetar dado é
sempre visível e nunca automática dentro de um fluxo maior. Toda tabela nova também precisa de
RLS — isso faz parte deste comando, não é um passo que alguém lembra depois.

## Procedimento

### 1. Classificar

Diga, na primeira linha, se a mudança é:

- **Aditiva** — model novo, campo opcional novo, índice novo. Baixo risco.
- **Destrutiva** — campo removido, model removido, tipo alterado, `@@unique` alterado, campo
  obrigatório novo em tabela que já tem linhas, `onDelete` afrouxado. **Exige aprovação explícita**
  antes do passo 4.

### 2. Editar o schema

Altere `apps/api/prisma/schema.prisma`. Comentário curto no model explicando qualquer restrição
não óbvia. Se o model guarda dinheiro, confirme que o campo é inteiro (centavos) — nunca
`Float`/`Decimal` para valor monetário.

### 3. Escrever o efeito, em português

Antes de gerar a migration, escreva em texto: **o que será criado, o que será alterado, e o que
pode ser perdido** — tabela por tabela. Se a resposta para "pode perder dado?" for "não sei",
trate como destrutiva e pare para aprovação.

### 4. Gerar a migration localmente

```
pnpm db:migrate
```

`DATABASE_URL`/`DIRECT_URL` vêm do `.env` da raiz (não `apps/api/.env` — `ARCHITECTURE.md` §3).
Confirme com o humano qual banco é se não tiver certeza — é o Supabase único deste projeto,
tratado como compartilhado por padrão. Peça um nome descritivo para a migration.

Se o comando avisar sobre **drift** ou oferecer **resetar o banco**, **pare e reporte** em vez de
confirmar — um reset apaga dado real; deixe o humano decidir.

### 5. Adicionar RLS na migration gerada

Abra o arquivo novo em `apps/api/prisma/migrations/<timestamp>_<nome>/migration.sql` e, para
**cada tabela criada** nesta migration, adicione ao final:

```sql
ALTER TABLE "NomeDaTabela" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "NomeDaTabela" FROM anon, authenticated;
```

Sem policy nenhuma (`docs/decisions/0004-rls-sem-policies.md`). Se a migration só altera uma
tabela que já existia (e já tinha RLS), não precisa repetir.

### 6. Rodar `db:check-rls`

```
pnpm db:check-rls
```

Tem que sair "ok". Se falhar, volte ao passo 5 — não considere a migration pronta com o check
vermelho.

### 7. Regenerar o client e verificar

```
pnpm db:generate
pnpm --filter @solidus/api typecheck
```

### 8. Registrar

- Atualize `ARCHITECTURE.md` se um model novo passou a existir.
- Confirme que o diretório de migration está no stage do commit junto com o `schema.prisma`.
- Se a mudança era destrutiva, registre no commit **quem aprovou** e o resumo do passo 3.
