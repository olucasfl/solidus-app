---
name: solidus-testing
description: Convenções de teste do Solidus (Jest no backend NestJS, Prisma sempre mockado). Use ao escrever qualquer teste novo, ao testar um módulo/feature nova, ou ao decidir como cobrir código que fala com Prisma ou com a API.
---

# Testes no Solidus

**Jest em `apps/api` já está configurado** (`ARCHITECTURE.md` §1). `apps/web` ainda não existe
(quando chegar, o runner — provavelmente Vitest — é decidido e documentado ali, não aqui).
`packages/shared` não tem runner.

## Onde o teste mora

Ao lado do arquivo: `health.service.ts` → `health.service.spec.ts`. Um arquivo de teste por
arquivo de produção com lógica — não crie um `__tests__/` paralelo. Teste e2e de rota HTTP:
`<nome>.e2e.spec.ts` ao lado do módulo (ver `src/modules/health/health.e2e.spec.ts`) — precisa do
ponto antes de `spec.ts` para o `testRegex` (`.*\.spec\.ts$`) encontrar o arquivo.

`*.module.ts` e `main.ts` ficam fora de qualquer meta de cobertura — são fiação de bootstrap, não
comportamento.

## Nada de banco real, nada de rede real

**`PrismaService` é sempre mockado como objeto simples de `jest.fn()`s** — só os métodos que
aquele teste realmente usa. Nunca instancie `PrismaClient` real num teste, nunca aponte para o
Postgres do Supabase.

```ts
const prisma = {
  isHealthy: jest.fn(),
} as unknown as PrismaService;

const service = new HealthService(prisma);
```

Em teste e2e com `@nestjs/testing`, como `PrismaModule` é `@Global()`, inclua-o nos `imports` do
`Test.createTestingModule` e troque o provider real por mock com `.overrideProvider(PrismaService)
.useValue(mock)` — isso deixa o mock visível para qualquer módulo importado, mesmo sem relação de
import direta com `PrismaModule` (ver `health.e2e.spec.ts`).

Se um serviço algum dia chamar uma API externa (Pluggy, Banco Central, brapi.dev), mocke no nível
do módulo (`jest.mock(...)` ou `global.fetch = jest.fn()`) — nenhum teste desta suíte deve fazer
chamada de rede real.

## Dinheiro: teste os dois lados da regra

Toda função em `apps/api/src/domain/` que lida com dinheiro precisa de teste cobrindo: valor
positivo, zero, negativo (se fizer sentido no domínio), e o caso de erro (float/NaN/Infinity
rejeitado por `assertCentavos`) — ver `domain/money/centavos.spec.ts` como referência de forma,
não de conteúdo (a próxima função não é sobre formatação).

## Como assertar

**Prefira asserção por estado a asserção por sequência.** Duas perguntas por teste:

1. O que a função/service **retornou**?
2. Com **quais argumentos** o Prisma (ou o mock de serviço) foi chamado?

```ts
expect(await service.check()).toEqual({
  status: 'ok',
  database: 'up',
  timestamp: expect.any(String),
});
expect(prisma.isHealthy).toHaveBeenCalled();
```

Assertar a ordem exata de chamadas trava o teste no _como_ em vez do _quê_. Use só quando a ordem
**é** o comportamento (ex.: transação Prisma).

## O que todo módulo/feature novo precisa cobrir

Além do caminho feliz:

- **Payload inválido** → 400 (campo não declarado no DTO, string acima do limite, número fora do
  range).
- **Rota sem auth** → 401 quando não é `@Public()` (o guard global já cobre isso por padrão —
  teste quando a spec adicionar verificação real de token, spec `01-fundacao-auth`).
- **Caso vazio** → o que a rota mostra quando não há nada (`[]`, 404 — decida e teste).
- Se a lógica ramificar (condicional de negócio, cálculo), cubra os dois lados da ramificação.

## Loop de verificação

```
pnpm --filter @solidus/api typecheck
pnpm --filter @solidus/api test -- <pattern>   # o teste que você acabou de escrever
pnpm --filter @solidus/api test                 # suíte inteira do workspace
pnpm lint
pnpm build
```

Só depois disso, commit.

## Contrato: o teste unitário não substitui `/qa-verify`

Um teste com `PrismaService` mockado **não prova** que a rota responde o que a spec diz — ele
prova que o service chama o Prisma direito. Para o contrato ponta a ponta, use `/qa-verify`: uma
verificação por critério de aceite, contra a API local (`http://localhost:3000`) no ar. Os dois
são necessários e cobrem coisas diferentes.
