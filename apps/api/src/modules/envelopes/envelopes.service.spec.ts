import { Prisma } from '@prisma/client';
import type { Carteira, CaixinhaNaCarteira } from '@solidus/shared';
import { PrismaService } from '../../database/prisma.service';
import { type CarteiraService } from '../carteira/carteira.service';
import { type ReservaService } from '../reserva/reserva.service';
import { EnvelopeJaExisteError, EnvelopeNaoEncontradoError } from './envelopes-errors';
import { EnvelopesService } from './envelopes.service';

// Dados 100% sintéticos (RULES §8).
const U = 'user-1';
const ID = '11111111-1111-4111-8111-111111111111';

function cx(parcial: Partial<CaixinhaNaCarteira> = {}): CaixinhaNaCarteira {
  return {
    id: 'cx-1',
    nome: 'Turbo',
    percentualCdiBp: 11_500,
    reservaDeGastos: false,
    reservaEmergencia: false,
    ativa: true,
    saldoInformado: null,
    saldoBrutoEstimadoCentavos: 110_000,
    rendimentoBrutoCentavos: 0,
    impostos: null,
    saldoLiquidoEstimadoCentavos: 100_000,
    rendimentoLiquidoCentavos: 0,
    avisos: [],
    ...parcial,
  };
}

function linha(parcial: Record<string, unknown> = {}) {
  return {
    id: ID,
    userId: U,
    nome: 'Viagem',
    alocadoCentavos: 0,
    metaCentavos: null,
    criadoEm: new Date('2026-10-01T00:00:00Z'),
    atualizadoEm: new Date('2026-10-01T00:00:00Z'),
    ...parcial,
  };
}

const duplicado = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'teste',
  });

function montar() {
  const prisma = {
    conta: { findMany: jest.fn().mockResolvedValue([{ tipo: 'CORRENTE', saldoCentavos: 4_545 }]) },
    envelope: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: ID }),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const carteira = {
    consultar: jest.fn().mockResolvedValue({
      data: '2026-10-07',
      caixinhas: [cx()],
      totais: { patrimonioCentavos: 0, investidoCentavos: 0, disponivelParaGastarCentavos: 0 },
      avisos: [],
    } satisfies Carteira),
  };
  const reserva = { obter: jest.fn().mockResolvedValue({ metaCentavos: 0 }) };
  const service = new EnvelopesService(
    prisma as unknown as PrismaService,
    carteira as unknown as CarteiraService,
    reserva as unknown as ReservaService,
  );
  return { prisma, carteira, reserva, service };
}

describe('EnvelopesService.obter', () => {
  it('CA-01: compõe Caixinhas (líquido) + conta corrente e entrega o livre', async () => {
    const { prisma, service } = montar();
    prisma.envelope.findMany.mockResolvedValue([
      linha({ id: 'a', nome: 'Viagem', alocadoCentavos: 30_000, metaCentavos: 100_000 }),
    ]);

    const r = await service.obter(U);

    expect(r.disponivel).toEqual({
      caixinhasCentavos: 100_000,
      contaCorrenteCentavos: 4_545,
      totalCentavos: 104_545,
    });
    expect(r.totalAlocadoCentavos).toBe(30_000);
    expect(r.livreCentavos).toBe(74_545);
    expect(r.envelopes).toEqual([
      {
        id: 'a',
        nome: 'Viagem',
        alocadoCentavos: 30_000,
        metaCentavos: 100_000,
        progressoBp: 3_000,
        faltaCentavos: 70_000,
        atingida: false,
      },
    ]);
    expect(r.data).toBe('2026-10-07');
  });

  it('CA-05/06: a reserva automática reserva o saldo todo e usa a meta da spec da reserva', async () => {
    const { carteira, reserva, service } = montar();
    carteira.consultar.mockResolvedValue({
      data: '2026-10-07',
      caixinhas: [cx({ reservaEmergencia: true, saldoLiquidoEstimadoCentavos: 800_000 })],
      totais: { patrimonioCentavos: 0, investidoCentavos: 0, disponivelParaGastarCentavos: 0 },
      avisos: [],
    });
    reserva.obter.mockResolvedValue({ metaCentavos: 600_000 });

    const r = await service.obter(U);

    expect(r.reserva).toEqual({
      valorCentavos: 800_000,
      metaCentavos: 600_000,
      excedenteCentavos: 200_000,
    });
    expect(reserva.obter).toHaveBeenCalledWith(U);
    expect(r.livreCentavos).toBe(800_000 + 4_545 - 800_000);
  });

  it('CA-03: cartão não soma e avisa; CA-04: sem conta corrente avisa', async () => {
    const { prisma, service } = montar();
    prisma.conta.findMany.mockResolvedValue([{ tipo: 'CARTAO', saldoCentavos: 9_492 }]);

    const r = await service.obter(U);

    expect(r.disponivel.contaCorrenteCentavos).toBe(0);
    expect(r.avisos).toEqual(
      expect.arrayContaining(['FATURA_DO_CARTAO_NAO_DESCONTADA', 'SEM_CONTA_SINCRONIZADA']),
    );
  });

  it('CA-08: alocado acima do disponível → livre negativo + aviso, sem lançar', async () => {
    const { prisma, service } = montar();
    prisma.envelope.findMany.mockResolvedValue([linha({ alocadoCentavos: 5_000_000 })]);

    const r = await service.obter(U);

    expect(r.livreCentavos).toBeLessThan(0);
    expect(r.avisos).toContain('ALOCADO_ACIMA_DO_DISPONIVEL');
  });

  it('CA-15: lê contas e envelopes só do usuário da sessão, por data de criação', async () => {
    const { prisma, carteira, service } = montar();

    await service.obter('user-b');

    expect(prisma.conta.findMany.mock.calls[0]![0].where).toEqual({ userId: 'user-b' });
    expect(prisma.envelope.findMany.mock.calls[0]![0]).toMatchObject({
      where: { userId: 'user-b' },
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
    });
    expect(carteira.consultar).toHaveBeenCalledWith('user-b');
  });

  it('só leitura: obter nunca grava nada', async () => {
    const { prisma, service } = montar();

    await service.obter(U);

    expect(prisma.envelope.create).not.toHaveBeenCalled();
    expect(prisma.envelope.update).not.toHaveBeenCalled();
    expect(prisma.envelope.deleteMany).not.toHaveBeenCalled();
  });
});

describe('EnvelopesService.criar', () => {
  it('CA-09: padrão alocado 0 e sem meta; grava com o userId da sessão', async () => {
    const { prisma, service } = montar();
    prisma.envelope.create.mockResolvedValue(linha());

    const r = await service.criar(U, { nome: 'Viagem' });

    expect(prisma.envelope.create).toHaveBeenCalledWith({
      data: { userId: U, nome: 'Viagem', alocadoCentavos: 0, metaCentavos: null },
    });
    expect(r).toMatchObject({
      alocadoCentavos: 0,
      metaCentavos: null,
      progressoBp: null,
      atingida: false,
    });
  });

  it('CA-09: com meta e alocado devolve progresso e falta (25% de 100.000)', async () => {
    const { prisma, service } = montar();
    prisma.envelope.create.mockResolvedValue(
      linha({ alocadoCentavos: 25_000, metaCentavos: 100_000 }),
    );

    const r = await service.criar(U, {
      nome: 'Viagem',
      alocadoCentavos: 25_000,
      metaCentavos: 100_000,
    });

    expect(r).toMatchObject({ progressoBp: 2_500, faltaCentavos: 75_000, atingida: false });
  });

  it('meta null no POST é "sem meta"', async () => {
    const { prisma, service } = montar();
    prisma.envelope.create.mockResolvedValue(linha());

    await service.criar(U, { nome: 'X', metaCentavos: null });

    expect(prisma.envelope.create.mock.calls[0]![0].data.metaCentavos).toBeNull();
  });

  it('CA-11: nome já existente (violação de unicidade) → 409 ENVELOPE_JA_EXISTE', async () => {
    const { prisma, service } = montar();
    prisma.envelope.create.mockRejectedValue(duplicado());

    await expect(service.criar(U, { nome: 'Viagem' })).rejects.toBeInstanceOf(
      EnvelopeJaExisteError,
    );
  });

  it('outro erro do banco NÃO é mascarado de 409', async () => {
    const { prisma, service } = montar();
    const outro = new Error('banco fora');
    prisma.envelope.create.mockRejectedValue(outro);

    await expect(service.criar(U, { nome: 'Viagem' })).rejects.toBe(outro);
  });
});

describe('EnvelopesService.atualizar', () => {
  it('CA-12: parcial, só o que veio; a busca e o update filtram pelo usuário', async () => {
    const { prisma, service } = montar();
    prisma.envelope.update.mockResolvedValue(linha({ alocadoCentavos: 50_000 }));

    await service.atualizar(U, ID, { alocadoCentavos: 50_000 });

    expect(prisma.envelope.findFirst.mock.calls[0]![0].where).toEqual({ id: ID, userId: U });
    expect(prisma.envelope.update).toHaveBeenCalledWith({
      where: { id: ID, userId: U },
      data: { alocadoCentavos: 50_000 },
    });
  });

  it('CA-12: metaCentavos null REMOVE a meta (e é o único null que vale)', async () => {
    const { prisma, service } = montar();
    prisma.envelope.update.mockResolvedValue(linha());

    const r = await service.atualizar(U, ID, { metaCentavos: null });

    expect(prisma.envelope.update.mock.calls[0]![0].data).toEqual({ metaCentavos: null });
    expect(r.metaCentavos).toBeNull();
    expect(r.progressoBp).toBeNull();
  });

  it('CA-13: id inexistente ou de outro usuário → 404 e nada é atualizado', async () => {
    const { prisma, service } = montar();
    prisma.envelope.findFirst.mockResolvedValue(null);

    await expect(service.atualizar(U, ID, { nome: 'X' })).rejects.toBeInstanceOf(
      EnvelopeNaoEncontradoError,
    );
    expect(prisma.envelope.update).not.toHaveBeenCalled();
  });

  it('CA-11: renomear para um nome que já existe → 409', async () => {
    const { prisma, service } = montar();
    prisma.envelope.update.mockRejectedValue(duplicado());

    await expect(service.atualizar(U, ID, { nome: 'Setup' })).rejects.toBeInstanceOf(
      EnvelopeJaExisteError,
    );
  });
});

describe('EnvelopesService.remover', () => {
  it('CA-13: apaga só o do usuário da sessão', async () => {
    const { prisma, service } = montar();
    prisma.envelope.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.remover(U, ID)).resolves.toBeUndefined();

    expect(prisma.envelope.deleteMany).toHaveBeenCalledWith({ where: { id: ID, userId: U } });
  });

  it('CA-13: nada apagado (inexistente ou de outro usuário) → 404', async () => {
    const { prisma, service } = montar();
    prisma.envelope.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remover(U, ID)).rejects.toBeInstanceOf(EnvelopeNaoEncontradoError);
  });
});
