import * as relogio from '../../common/relogio';
import { PrismaService } from '../../database/prisma.service';
import { CdiGateway } from './cdi.gateway';
import { CdiService } from './cdi.service';
import { CdiIndisponivelError } from './carteira-errors';

function montar() {
  const prisma = {
    movimentoCaixinha: { aggregate: jest.fn().mockResolvedValue({ _min: { data: null } }) },
    cdiDia: {
      aggregate: jest.fn().mockResolvedValue({ _min: { data: null }, _max: { data: null } }),
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const gateway = { buscar: jest.fn().mockResolvedValue([]) };
  const service = new CdiService(
    prisma as unknown as PrismaService,
    gateway as unknown as CdiGateway,
  );
  return { prisma, gateway, service };
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeEach(() => {
  jest.spyOn(relogio, 'hojeUtc').mockReturnValue('2026-10-05');
});
afterEach(() => jest.restoreAllMocks());

describe('CdiService.sincronizar (CA-18)', () => {
  it('grava só os dias novos e devolve os contadores', async () => {
    const { prisma, gateway, service } = montar();
    gateway.buscar.mockResolvedValue([
      { data: '2026-10-01', taxaE8: 55_131 },
      { data: '2026-10-02', taxaE8: 55_132 },
    ]);
    prisma.cdiDia.findMany.mockResolvedValue([{ data: d('2026-10-01') }]);

    const r = await service.sincronizar();

    expect(r).toEqual({ dias: 2, novos: 1 });
    expect(prisma.cdiDia.createMany).toHaveBeenCalledWith({
      data: [{ data: d('2026-10-02'), taxaE8: 55_132 }],
      skipDuplicates: true,
    });
  });

  it('segunda execução com tudo já gravado não grava nada (idempotente)', async () => {
    const { prisma, gateway, service } = montar();
    gateway.buscar.mockResolvedValue([{ data: '2026-10-01', taxaE8: 55_131 }]);
    prisma.cdiDia.findMany.mockResolvedValue([{ data: d('2026-10-01') }]);

    await expect(service.sincronizar()).resolves.toEqual({ dias: 1, novos: 0 });
    expect(prisma.cdiDia.createMany).not.toHaveBeenCalled();
  });

  it('o erro do gateway (BCB fora do ar) sobe como está, sem gravar', async () => {
    const { prisma, gateway, service } = montar();
    gateway.buscar.mockRejectedValue(new CdiIndisponivelError());

    await expect(service.sincronizar()).rejects.toThrow(CdiIndisponivelError);
    expect(prisma.cdiDia.createMany).not.toHaveBeenCalled();
  });

  describe('de onde começa a busca', () => {
    it('sem nenhum CDI e sem movimentos: os últimos 30 dias', async () => {
      const { gateway, service } = montar();

      await service.sincronizar();

      expect(gateway.buscar).toHaveBeenCalledWith('2026-09-05', '2026-10-05');
    });

    it('sem nenhum CDI e com movimentos: desde o mais antigo', async () => {
      const { prisma, gateway, service } = montar();
      prisma.movimentoCaixinha.aggregate.mockResolvedValue({ _min: { data: d('2026-03-10') } });

      await service.sincronizar();

      expect(gateway.buscar).toHaveBeenCalledWith('2026-03-10', '2026-10-05');
    });

    it('com CDI gravado: relê só os últimos 7 dias', async () => {
      const { prisma, gateway, service } = montar();
      prisma.cdiDia.aggregate.mockResolvedValue({
        _min: { data: d('2026-03-10') },
        _max: { data: d('2026-10-01') },
      });
      prisma.movimentoCaixinha.aggregate.mockResolvedValue({ _min: { data: d('2026-05-01') } });

      await service.sincronizar();

      expect(gateway.buscar).toHaveBeenCalledWith('2026-09-24', '2026-10-05');
    });

    it('movimento mais antigo que o primeiro CDI gravado: faz o backfill', async () => {
      const { prisma, gateway, service } = montar();
      prisma.cdiDia.aggregate.mockResolvedValue({
        _min: { data: d('2026-06-01') },
        _max: { data: d('2026-10-01') },
      });
      prisma.movimentoCaixinha.aggregate.mockResolvedValue({ _min: { data: d('2026-02-15') } });

      await service.sincronizar();

      expect(gateway.buscar).toHaveBeenCalledWith('2026-02-15', '2026-10-05');
    });
  });
});
