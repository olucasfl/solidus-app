// Spike: le contas, transacoes e investimentos do item e salva o JSON CRU em spike-output/
// (ignorado pelo git; contem dados pessoais). Imprime so um resumo no terminal.
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PluggyClient } from 'pluggy-sdk';

// O pnpm roda o script a partir de apps/api, mas o .env fica na raiz do monorepo.
config({ path: resolve(__dirname, '../../../../.env') });

const { PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITEM_ID } = process.env;
if (!PLUGGY_CLIENT_ID || !PLUGGY_CLIENT_SECRET) {
  console.error('Preencha PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no .env.');
  process.exit(1);
}
if (!PLUGGY_ITEM_ID) {
  console.error('PLUGGY_ITEM_ID vazio. Rode antes: pnpm spike:connect');
  process.exit(1);
}

const OUT = resolve(__dirname, '../../../../spike-output');
const salvar = (nome: string, dado: unknown) =>
  writeFileSync(resolve(OUT, nome), JSON.stringify(dado, null, 2), 'utf8');

async function main() {
  mkdirSync(OUT, { recursive: true });
  const pluggy = new PluggyClient({
    clientId: PLUGGY_CLIENT_ID!,
    clientSecret: PLUGGY_CLIENT_SECRET!,
  });

  const item = await pluggy.fetchItem(PLUGGY_ITEM_ID!);
  salvar('item.json', item);
  console.log(`Item: status=${item.status} executionStatus=${item.executionStatus}`);
  console.log(`Ultima atualizacao: ${item.lastUpdatedAt}`);
  console.log(`Consentimento expira em: ${item.consentExpiresAt ?? '(nao informado)'}`);

  const contas = await pluggy.fetchAccounts(PLUGGY_ITEM_ID!);
  salvar('contas.json', contas.results);
  console.log(`\nContas: ${contas.results.length}`);
  for (const c of contas.results) {
    console.log(`  - ${c.type}/${c.subtype} "${c.name}" saldo=${c.balance}`);
    const txs = await pluggy.fetchAllTransactions(c.id);
    salvar(`transacoes-${c.id}.json`, txs);
    const comCategoria = txs.filter((t) => t.category).length;
    console.log(`    transacoes=${txs.length} com categoria do Pluggy=${comCategoria}`);
  }

  const inv = await pluggy.fetchInvestments(PLUGGY_ITEM_ID!);
  salvar('investimentos.json', inv.results);
  const soma = inv.results.reduce((s, i) => s + (i.balance ?? 0), 0);
  console.log(`\nInvestimentos: ${inv.results.length} itens, soma dos saldos=${soma.toFixed(2)}`);
  for (const i of inv.results) {
    console.log(
      `  - ${i.type}/${i.subtype ?? '-'} "${i.name}" saldo=${i.balance} status=${i.status ?? '-'}`,
    );
  }
  console.log(`\nJSON cru salvo em ${OUT}`);
}

main().catch((e) => {
  console.error('Falha no spike:', e instanceof Error ? e.message : e);
  process.exit(1);
});
