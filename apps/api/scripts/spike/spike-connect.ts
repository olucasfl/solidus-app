// Spike: abre o widget Pluggy Connect numa pagina local para voce autorizar o MeuPluggy
// uma vez. Ao concluir, grava PLUGGY_ITEM_ID no .env e encerra.
// O Client Secret nunca vai para o navegador: so o connectToken (curto) e entregue a pagina.
import { config } from 'dotenv';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PluggyClient } from 'pluggy-sdk';

const PORT = 4310;
const ENV_PATH = resolve(__dirname, '../../../../.env');
// O pnpm roda o script a partir de apps/api, mas o .env fica na raiz do monorepo.
config({ path: ENV_PATH });

const clientId = process.env.PLUGGY_CLIENT_ID;
const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Preencha PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no .env antes de rodar.');
  process.exit(1);
}

const pluggy = new PluggyClient({ clientId, clientSecret });

const PAGE = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Solidus - conectar Pluggy</title></head>
<body style="font-family:system-ui;max-width:520px;margin:4rem auto">
<h1>Solidus</h1>
<p id="msg">Abrindo o Pluggy Connect... escolha o conector <b>MeuPluggy</b>.</p>
<script src="https://cdn.pluggy.ai/pluggy-connect/v2.8.0/pluggy-connect.js"></script>
<script>
(async () => {
  const msg = document.getElementById('msg');
  const { accessToken } = await (await fetch('/token')).json();
  new PluggyConnect({
    connectToken: accessToken,
    onSuccess: async ({ item }) => {
      await fetch('/item', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: item.id }) });
      msg.textContent = 'Conectado! Item ID salvo no .env. Pode fechar esta aba.';
    },
    onError: (e) => { msg.textContent = 'Erro: ' + (e && e.message ? e.message : JSON.stringify(e)); },
  }).init();
})();
</script></body></html>`;

function saveItemId(itemId: string) {
  const atual = readFileSync(ENV_PATH, 'utf8');
  const linha = `PLUGGY_ITEM_ID=${itemId}`;
  const novo = /^PLUGGY_ITEM_ID=.*$/m.test(atual)
    ? atual.replace(/^PLUGGY_ITEM_ID=.*$/m, linha)
    : `${atual}\n${linha}\n`;
  writeFileSync(ENV_PATH, novo, 'utf8');
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(PAGE);
    } else if (req.method === 'GET' && req.url === '/token') {
      const { accessToken } = await pluggy.createConnectToken();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ accessToken }));
    } else if (req.method === 'POST' && req.url === '/item') {
      let corpo = '';
      for await (const parte of req) corpo += parte;
      const { itemId } = JSON.parse(corpo) as { itemId?: string };
      if (!itemId || !/^[0-9a-f-]{36}$/i.test(itemId)) {
        res.statusCode = 400;
        res.end('itemId invalido');
        return;
      }
      saveItemId(itemId);
      res.end('ok');
      console.log('PLUGGY_ITEM_ID gravado no .env. Encerrando.');
      setTimeout(() => process.exit(0), 300);
    } else {
      res.statusCode = 404;
      res.end();
    }
  } catch (e) {
    console.error('Falha:', e instanceof Error ? e.message : e);
    res.statusCode = 500;
    res.end('erro');
  }
});

// Escuta so em localhost: a pagina entrega um connectToken, entao nao pode ficar exposta na rede.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Abra http://localhost:${PORT} no navegador e autorize o MeuPluggy.`);
});
