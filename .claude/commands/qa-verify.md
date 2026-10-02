---
description: Prova, critério a critério, se a spec está atendida contra a API local no ar. Não corrige nada.
argument-hint: <caminho-da-spec>
---

Verifique **$ARGUMENTS** contra a implementação atual. Sua entrega é **evidência**, não opinião.

## Regra que define este comando

**Você não corrige nada.** Se algo falhar, reporte e pare. Correção é `/fix-bug`, em outra
execução. Misturar as duas coisas faz o mesmo agente racionalizar um resultado ruim como aceitável
para "fechar a tarefa".

## Preparação

1. Leia a spec e extraia os critérios de aceite. Se não estiverem em BDD, avise na primeira
   linha.
2. Leia a seção **Requisitos de saída**: método, path, DTO, response. É dela que sai cada
   verificação.
3. Suba a API **local**: confirme que o Postgres (`DATABASE_URL`/`DIRECT_URL`, no `.env` da raiz)
   está acessível e rode `pnpm --filter @solidus/api dev`. Espere ficar de pé (log
   "API em http://localhost:..."). Se não subir, **avise e pare** — não simule resultado.

## Regras de execução

- **Só `http://localhost:3000`** (ou a `PORT` configurada). Nunca qualquer ambiente que não seja
  este checkout local. `apps/web` ainda não existe — não há tela para verificar.
- Teste também os caminhos negativos: payload inválido → 400; rota sem `@Public()` sem header de
  auth → 401; recurso inexistente → 404 (ou o que a spec definir); campo não declarado no DTO →
  removido ou 400.
- Se a spec envolve valor monetário, confira que a resposta está em centavos inteiros, nunca com
  ponto decimal de reais.

## Formato de cada verificação

```
# Critério 2: Dado um payload inválido, quando POST /transacoes, então 400
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/transacoes \
  -H "Content-Type: application/json" -d '{}'
```

Cole o comando **e a saída real**, nunca "deveria funcionar".

## Saída

| #   | Critério                  | Passou? | Evidência                   |
| --- | ------------------------- | ------- | --------------------------- |
| 1   | Dado X, quando Y, então Z | ✅      | `curl … → 201 {"id":"..."}` |
| 2   | …                         | ❌      | esperado 400, recebido 201  |

Feche com uma linha: **quantos passaram de quantos**, e se a feature pode ser fechada. Se houver
falha, liste os critérios que falharam — sem propor a correção.
