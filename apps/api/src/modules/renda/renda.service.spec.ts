import { type FonteRenda } from '@prisma/client';
import { type PrismaService } from '../../database/prisma.service';
import { type CategorizacaoService } from '../categorizacao/categorizacao.service';
import {
  DataAnteriorAoInicioError,
  FonteJaExisteError,
  FonteNaoEncontradaError,
  FonteNaoVigenteError,
  MesmaOrigemError,
  NaoEEntradaError,
  SemContraparteError,
  TransacaoNaoEncontradaError,
} from './renda-errors';
import { RendaService } from './renda.service';

// Dados 100% sintéticos (RULES §8). As chaves aqui são strings quaisquer, nunca um hash real.
const U = 'user-1';
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function fonte(parcial: Partial<FonteRenda> = {}): FonteRenda {
  return {
    id: 'fonte-a',
    userId: U,
    tipo: 'SALARIO',
    origem: 'MANUAL',
    contraparteChave: 'chave-a',
    nome: 'Empresa Teste',
    docMascarado: '**.345.678/****-**',
    vigenteDesde: d('2026-01-01'),
    vigenteAte: null,
    ativa: true,
    criadoEm: d('2026-01-01'),
    atualizadoEm: d('2026-01-01'),
    ...parcial,
  };
}

const entrada = (parcial: object = {}) => ({
  tipo: 'CREDITO',
  data: d('2026-06-05'),
  contraparteChave: 'chave-b',
  contraparteNome: 'Outra Empresa',
  contraparteDocMascarado: '**.111.222/****-**',
  ...parcial,
});

function montar() {
  const prisma = {
    transacao: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(entrada()),
      aggregate: jest.fn().mockResolvedValue({ _min: { data: d('2026-02-03') } }),
    },
    fonteRenda: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: { data: Partial<FonteRenda> }) =>
        fonte({ id: 'nova', ...data }),
      ),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<FonteRenda> }) =>
          fonte({ id: where.id, ...data }),
      ),
    },
    $transaction: jest.fn(async (operacoes: Promise<unknown>[]) => Promise.all(operacoes)),
  };
  const categorizacao = {
    recalcular: jest.fn().mockResolvedValue({ analisadas: 0, alteradas: 0 }),
  };
  const service = new RendaService(
    prisma as unknown as PrismaService,
    categorizacao as unknown as CategorizacaoService,
  );
  return { prisma, categorizacao, service };
}

describe('RendaService.reconhecerRecorrentes', () => {
  // Valor padrão R$ 1.000: acima do mínimo de R$ 300, para só os testes de valor mexerem nele.
  const credito = (chave: string, data: string, valorCentavos = 100_000) => ({
    contraparteChave: chave,
    contraparteNome: 'Pagador Teste',
    contraparteDocMascarado: '***.456.789-**',
    data: d(data),
    valorCentavos,
  });
  const tresMeses = (chave: string, valorCentavos?: number) => [
    credito(chave, '2026-03-10', valorCentavos),
    credito(chave, '2026-02-10', valorCentavos),
    credito(chave, '2026-01-10', valorCentavos),
  ];

  it('CA-05: origem que pagou em 3 meses distintos vira fonte RECORRENTE automática', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findMany.mockResolvedValue(tresMeses('x'));

    expect(await service.reconhecerRecorrentes(U)).toBe(1);

    const { data } = prisma.fonteRenda.createMany.mock.calls[0]![0];
    expect(data).toEqual([
      expect.objectContaining({
        userId: U,
        tipo: 'RECORRENTE',
        origem: 'AUTOMATICA',
        contraparteChave: 'x',
        nome: 'Pagador Teste',
        vigenteDesde: d('2026-01-10'),
      }),
    ]);
  });

  it('só olha entradas de Pix de pessoas (nunca fatura, aplicação ou conta própria)', async () => {
    const { prisma, service } = montar();
    await service.reconhecerRecorrentes(U);

    expect(prisma.transacao.findMany.mock.calls[0]![0].where).toMatchObject({
      userId: U,
      tipo: 'CREDITO',
      categoriaPluggy: { in: ['Transfers', 'Third party transfers'] },
    });
  });

  it('2 meses não basta, e vários no mesmo mês contam como um', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findMany.mockResolvedValue([
      credito('x', '2026-03-10'),
      credito('x', '2026-03-11'),
      credito('x', '2026-02-10'),
    ]);

    expect(await service.reconhecerRecorrentes(U)).toBe(0);
    expect(prisma.fonteRenda.createMany).not.toHaveBeenCalled();
  });

  it('CA-05b: rateio (muitos pagamentos pequenos por mês) NÃO vira fonte, mesmo pagando todo mês', async () => {
    const { prisma, service } = montar();
    // 12 pagamentos de R$ 85 em 3 meses: 4 por mês e valor médio abaixo de R$ 300.
    prisma.transacao.findMany.mockResolvedValue(
      ['2026-01', '2026-02', '2026-03'].flatMap((mes) =>
        [1, 2, 3, 4].map((dia) => credito('rateio', `${mes}-0${dia}`, 8_500)),
      ),
    );

    expect(await service.reconhecerRecorrentes(U)).toBe(0);
    expect(prisma.fonteRenda.createMany).not.toHaveBeenCalled();
  });

  it('CA-05b: valor médio abaixo de R$ 300 NÃO vira fonte, e frequência alta com valor alto também não', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findMany.mockResolvedValue(tresMeses('pequena', 29_999));
    expect(await service.reconhecerRecorrentes(U)).toBe(0);

    prisma.transacao.findMany.mockResolvedValue(
      ['2026-01', '2026-02', '2026-03'].flatMap((mes) =>
        [1, 2, 3, 4].map((dia) => credito('frequente', `${mes}-0${dia}`, 61_200)),
      ),
    );
    expect(await service.reconhecerRecorrentes(U)).toBe(0);
    expect(prisma.fonteRenda.createMany).not.toHaveBeenCalled();
  });

  it('origem que já tem fonte (mesmo DESATIVADA pelo usuário) não é recriada', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findMany.mockResolvedValue(tresMeses('x'));
    prisma.fonteRenda.findMany.mockResolvedValue([{ contraparteChave: 'x' }]);

    expect(await service.reconhecerRecorrentes(U)).toBe(0);
    expect(prisma.fonteRenda.createMany).not.toHaveBeenCalled();
  });

  describe('poda das fontes automáticas que deixaram de qualificar', () => {
    it('remove só as AUTOMATICAS, RECORRENTES e ATIVAS que não qualificam mais, do usuário da sessão', async () => {
      const { prisma, service } = montar();
      prisma.transacao.findMany.mockResolvedValue(tresMeses('continua'));
      prisma.fonteRenda.findMany.mockResolvedValue([{ contraparteChave: 'continua' }]);

      await service.reconhecerRecorrentes(U);

      // Fonte desativada pelo usuário, promovida a salário (MANUAL) ou de outro usuário nunca entra aqui.
      expect(prisma.fonteRenda.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: U,
          tipo: 'RECORRENTE',
          origem: 'AUTOMATICA',
          ativa: true,
          contraparteChave: { notIn: ['continua'] },
        },
      });
    });

    it('se nenhuma origem qualifica mais, a lista de "manter" é vazia (poda todas as automáticas)', async () => {
      const { prisma, service } = montar();
      prisma.transacao.findMany.mockResolvedValue([]);

      await service.reconhecerRecorrentes(U);

      expect(prisma.fonteRenda.deleteMany.mock.calls[0]![0].where.contraparteChave).toEqual({
        notIn: [],
      });
    });

    it('devolve criadas + removidas, para quem chama saber que precisa reaplicar a categorização', async () => {
      const { prisma, service } = montar();
      prisma.transacao.findMany.mockResolvedValue(tresMeses('nova'));
      prisma.fonteRenda.deleteMany.mockResolvedValue({ count: 3 });

      expect(await service.reconhecerRecorrentes(U)).toBe(4);
    });

    it('só poda, sem criar nada: devolve as removidas e não chama createMany', async () => {
      const { prisma, service } = montar();
      prisma.transacao.findMany.mockResolvedValue([]);
      prisma.fonteRenda.deleteMany.mockResolvedValue({ count: 2 });

      expect(await service.reconhecerRecorrentes(U)).toBe(2);
      expect(prisma.fonteRenda.createMany).not.toHaveBeenCalled();
    });

    it('nada para podar nem criar: devolve 0 (o sync não reaplica a categorização à toa)', async () => {
      const { service } = montar();

      expect(await service.reconhecerRecorrentes(U)).toBe(0);
    });
  });
});

describe('RendaService.definirFonteSalario', () => {
  it('CA-02: cria a fonte SALARIO desde o PRIMEIRO recebimento da origem e reaplica a categorização', async () => {
    const { prisma, categorizacao, service } = montar();

    const dto = await service.definirFonteSalario(U, 'tx-1');

    expect(prisma.fonteRenda.create.mock.calls[0]![0].data).toMatchObject({
      userId: U,
      tipo: 'SALARIO',
      origem: 'MANUAL',
      contraparteChave: 'chave-b',
      vigenteDesde: d('2026-02-03'),
    });
    expect(dto).toMatchObject({
      tipo: 'SALARIO',
      origem: 'MANUAL',
      vigenteDesde: '2026-02-03',
      vigenteAte: null,
    });
    expect(categorizacao.recalcular).toHaveBeenCalledWith(U);
  });

  it('a busca da transação filtra pelo usuário da sessão', async () => {
    const { prisma, service } = montar();
    await service.definirFonteSalario(U, 'tx-1');

    expect(prisma.transacao.findFirst.mock.calls[0]![0].where).toEqual({ id: 'tx-1', userId: U });
  });

  it('CA-11: transação inexistente ou de outro usuário → 404', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findFirst.mockResolvedValue(null);

    await expect(service.definirFonteSalario(U, 'tx-x')).rejects.toBeInstanceOf(
      TransacaoNaoEncontradaError,
    );
  });

  it('CA-11: saída não pode ser salário → 422', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findFirst.mockResolvedValue(entrada({ tipo: 'DEBITO' }));

    await expect(service.definirFonteSalario(U, 'tx-1')).rejects.toBeInstanceOf(NaoEEntradaError);
  });

  it('CA-11: transação sem contraparte → 422 e nada é criado', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findFirst.mockResolvedValue(entrada({ contraparteChave: null }));

    await expect(service.definirFonteSalario(U, 'tx-1')).rejects.toBeInstanceOf(
      SemContraparteError,
    );
    expect(prisma.fonteRenda.create).not.toHaveBeenCalled();
  });

  it('CA-03: origem que já é salário vigente → 409', async () => {
    const { prisma, categorizacao, service } = montar();
    prisma.fonteRenda.findMany.mockResolvedValue([fonte({ contraparteChave: 'chave-b' })]);

    await expect(service.definirFonteSalario(U, 'tx-1')).rejects.toBeInstanceOf(FonteJaExisteError);
    expect(categorizacao.recalcular).not.toHaveBeenCalled();
  });

  it('promove uma fonte RECORRENTE automática já existente em vez de duplicar', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findMany.mockResolvedValue([
      fonte({
        id: 'rec',
        tipo: 'RECORRENTE',
        origem: 'AUTOMATICA',
        contraparteChave: 'chave-b',
        ativa: false,
      }),
    ]);

    const dto = await service.definirFonteSalario(U, 'tx-1');

    expect(prisma.fonteRenda.create).not.toHaveBeenCalled();
    expect(prisma.fonteRenda.update).toHaveBeenCalledWith({
      where: { id: 'rec', userId: U },
      data: { tipo: 'SALARIO', origem: 'MANUAL', ativa: true, vigenteAte: null },
    });
    expect(dto).toMatchObject({ id: 'rec', tipo: 'SALARIO', ativa: true });
  });

  it('origem que já teve salário ENCERRADO volta no dia seguinte ao fim, sem sobrepor vigências', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findMany.mockResolvedValue([
      fonte({ contraparteChave: 'chave-b', vigenteAte: d('2026-04-30') }),
    ]);

    await service.definirFonteSalario(U, 'tx-1');

    expect(prisma.fonteRenda.create.mock.calls[0]![0].data.vigenteDesde).toEqual(d('2026-05-01'));
  });
});

describe('RendaService.trocarFonteSalario', () => {
  it('CA-03: encerra a fonte escolhida no dia ANTERIOR e abre a nova NO DIA da transação, de uma vez', async () => {
    const { prisma, categorizacao, service } = montar();
    prisma.fonteRenda.findFirst
      .mockResolvedValueOnce(fonte({ id: 'fonte-a', contraparteChave: 'chave-a' }))
      .mockResolvedValueOnce(null);

    const r = await service.trocarFonteSalario(U, 'fonte-a', 'tx-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.fonteRenda.update).toHaveBeenCalledWith({
      where: { id: 'fonte-a', userId: U },
      data: { vigenteAte: d('2026-06-04') },
    });
    expect(prisma.fonteRenda.create.mock.calls[0]![0].data).toMatchObject({
      userId: U,
      tipo: 'SALARIO',
      contraparteChave: 'chave-b',
      vigenteDesde: d('2026-06-05'),
    });
    expect(r.encerrada).toMatchObject({ id: 'fonte-a', vigenteAte: '2026-06-04' });
    expect(r.nova).toMatchObject({ vigenteDesde: '2026-06-05', vigenteAte: null });
    expect(categorizacao.recalcular).toHaveBeenCalledWith(U);
  });

  it('CA-03b: troca só a fonte escolhida; outras fontes de salário não são tocadas', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findFirst
      .mockResolvedValueOnce(fonte({ id: 'fonte-a' }))
      .mockResolvedValueOnce(null);

    await service.trocarFonteSalario(U, 'fonte-a', 'tx-1');

    expect(prisma.fonteRenda.update).toHaveBeenCalledTimes(1);
    expect(prisma.fonteRenda.update.mock.calls[0]![0].where.id).toBe('fonte-a');
  });

  it('fonte inexistente ou de outro usuário → 404', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findFirst.mockResolvedValue(null);

    await expect(service.trocarFonteSalario(U, 'x', 'tx-1')).rejects.toBeInstanceOf(
      FonteNaoEncontradaError,
    );
    expect(prisma.fonteRenda.findFirst.mock.calls[0]![0].where).toEqual({ id: 'x', userId: U });
  });

  it.each([
    ['recorrente', { tipo: 'RECORRENTE' as const }],
    ['desativada', { ativa: false }],
    ['já encerrada', { vigenteAte: d('2026-03-31') }],
  ])('fonte %s não pode ser trocada → 422', async (_nome, parcial) => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findFirst.mockResolvedValue(fonte(parcial));

    await expect(service.trocarFonteSalario(U, 'fonte-a', 'tx-1')).rejects.toBeInstanceOf(
      FonteNaoVigenteError,
    );
  });

  it('transação da mesma origem → 422', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findFirst.mockResolvedValue(fonte({ contraparteChave: 'chave-b' }));

    await expect(service.trocarFonteSalario(U, 'fonte-a', 'tx-1')).rejects.toBeInstanceOf(
      MesmaOrigemError,
    );
  });

  it('nova origem que já é salário vigente → 409', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findFirst
      .mockResolvedValueOnce(fonte())
      .mockResolvedValueOnce({ id: 'outra' });

    await expect(service.trocarFonteSalario(U, 'fonte-a', 'tx-1')).rejects.toBeInstanceOf(
      FonteJaExisteError,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('transação anterior ao início da fonte → 422 e nada muda', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findFirst
      .mockResolvedValueOnce(fonte({ vigenteDesde: d('2026-07-01') }))
      .mockResolvedValueOnce(null);

    await expect(service.trocarFonteSalario(U, 'fonte-a', 'tx-1')).rejects.toBeInstanceOf(
      DataAnteriorAoInicioError,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a transação nova precisa ser entrada com contraparte', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findFirst.mockResolvedValue(fonte());
    prisma.transacao.findFirst.mockResolvedValue(entrada({ tipo: 'DEBITO' }));

    await expect(service.trocarFonteSalario(U, 'fonte-a', 'tx-1')).rejects.toBeInstanceOf(
      NaoEEntradaError,
    );
  });
});

describe('RendaService.salario', () => {
  const linha = (id: string, data: string, valorCentavos: number, chave: string | null) => ({
    id,
    data: d(data),
    valorCentavos,
    tipo: 'CREDITO' as const,
    contraparteChave: chave,
  });

  it('CA-04: devolve fontes vigentes, valor atual (último de cada fonte) e histórico do mais recente', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findMany.mockResolvedValue([
      fonte({ id: 'a', contraparteChave: 'chave-a' }),
      fonte({ id: 'b', contraparteChave: 'chave-b', vigenteDesde: d('2026-02-01') }),
      fonte({
        id: 'velha',
        contraparteChave: 'chave-v',
        vigenteAte: d('2025-12-31'),
        vigenteDesde: d('2025-01-01'),
      }),
    ]);
    prisma.transacao.findMany.mockResolvedValue([
      linha('t3', '2026-06-05', 150_000, 'chave-a'),
      linha('t2', '2026-06-02', 80_000, 'chave-b'),
      linha('t1', '2026-05-05', 140_000, 'chave-a'),
    ]);

    const r = await service.salario(U);

    expect(r.fontesAtuais.map((f) => f.id)).toEqual(['a', 'b']);
    expect(r.valorAtualCentavos).toBe(230_000);
    expect(r.historico.map((h) => [h.transacaoId, h.fonteId])).toEqual([
      ['t3', 'a'],
      ['t2', 'b'],
      ['t1', 'a'],
    ]);
    expect(r.fontes).toHaveLength(3);
  });

  it('consulta só o que é do usuário e só entradas categorizadas como SALARIO', async () => {
    const { prisma, service } = montar();
    await service.salario(U);

    expect(prisma.transacao.findMany.mock.calls[0]![0].where).toEqual({
      userId: U,
      categoria: 'SALARIO',
      tipo: 'CREDITO',
    });
    expect(prisma.fonteRenda.findMany.mock.calls[0]![0].where).toEqual({
      userId: U,
      tipo: 'SALARIO',
    });
  });

  it('sem fonte nem recebimento: listas vazias e valor atual null', async () => {
    const { service } = montar();

    expect(await service.salario(U)).toEqual({
      fontesAtuais: [],
      valorAtualCentavos: null,
      historico: [],
      fontes: [],
    });
  });

  it('salário vindo de uma regra do usuário (sem fonte) aparece no histórico com fonteId null', async () => {
    const { prisma, service } = montar();
    prisma.transacao.findMany.mockResolvedValue([linha('t1', '2026-06-05', 100_000, null)]);

    const r = await service.salario(U);

    expect(r.historico).toEqual([
      {
        data: '2026-06-05T00:00:00.000Z',
        valorCentavos: 100_000,
        fonteId: null,
        transacaoId: 't1',
      },
    ]);
    expect(r.valorAtualCentavos).toBeNull();
  });

  it('CA-14: nenhuma resposta contém a chave do documento', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findMany.mockResolvedValue([
      fonte({ contraparteChave: 'CHAVE-SECRETA-XYZ' }),
    ]);
    prisma.transacao.findMany.mockResolvedValue([
      linha('t1', '2026-06-05', 100_000, 'CHAVE-SECRETA-XYZ'),
    ]);

    expect(JSON.stringify(await service.salario(U))).not.toContain('CHAVE-SECRETA-XYZ');
    expect(JSON.stringify(await service.listarFontes(U))).not.toContain('CHAVE-SECRETA-XYZ');
  });
});

describe('RendaService.listarFontes e ativarFonte', () => {
  it('lista só as fontes do usuário', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findMany.mockResolvedValue([fonte()]);

    expect(await service.listarFontes(U)).toHaveLength(1);
    expect(prisma.fonteRenda.findMany.mock.calls[0]![0].where).toEqual({ userId: U });
  });

  it('CA-06: desativar uma fonte grava ativa=false e reaplica a categorização', async () => {
    const { prisma, categorizacao, service } = montar();
    prisma.fonteRenda.findFirst.mockResolvedValue(fonte({ id: 'rec', tipo: 'RECORRENTE' }));

    const dto = await service.ativarFonte(U, 'rec', false);

    expect(prisma.fonteRenda.update).toHaveBeenCalledWith({
      where: { id: 'rec', userId: U },
      data: { ativa: false },
    });
    expect(dto.ativa).toBe(false);
    expect(categorizacao.recalcular).toHaveBeenCalledWith(U);
  });

  it('fonte inexistente ou de outro usuário → 404 sem alterar nada', async () => {
    const { prisma, service } = montar();
    prisma.fonteRenda.findFirst.mockResolvedValue(null);

    await expect(service.ativarFonte(U, 'x', false)).rejects.toBeInstanceOf(
      FonteNaoEncontradaError,
    );
    expect(prisma.fonteRenda.update).not.toHaveBeenCalled();
  });
});
