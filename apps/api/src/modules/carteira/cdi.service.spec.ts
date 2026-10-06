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

describe('CdiService.atualizarSeNecessario — o CDI se mantém sozinho', () => {
  const AGORA = 1_800_000_000_000;

  function pronto(opcoes: {
    movimento?: string | null;
    primeiroCdi?: string | null;
    ultimoCdi?: string | null;
  }) {
    const m = montar();
    m.prisma.movimentoCaixinha.aggregate.mockResolvedValue({
      _min: { data: opcoes.movimento ? d(opcoes.movimento) : null },
    });
    m.prisma.cdiDia.aggregate.mockResolvedValue({
      _min: { data: opcoes.primeiroCdi ? d(opcoes.primeiroCdi) : null },
      _max: { data: opcoes.ultimoCdi ? d(opcoes.ultimoCdi) : null },
    });
    jest.spyOn(Date, 'now').mockReturnValue(AGORA);
    return m;
  }

  it('sem nenhum movimento não há o que calcular: não busca', async () => {
    const { gateway, service } = pronto({ movimento: null });

    await service.atualizarSeNecessario();

    expect(gateway.buscar).not.toHaveBeenCalled();
  });

  it('com movimento e nenhum CDI gravado: busca', async () => {
    const { gateway, service } = pronto({ movimento: '2026-09-01' });

    await service.atualizarSeNecessario();

    expect(gateway.buscar).toHaveBeenCalledTimes(1);
  });

  it('CDI de ontem está em dia; de dois dias atrás ou mais está velho', async () => {
    const emDia = pronto({
      movimento: '2026-09-01',
      primeiroCdi: '2026-08-01',
      ultimoCdi: '2026-10-04',
    });
    await emDia.service.atualizarSeNecessario();
    expect(emDia.gateway.buscar).not.toHaveBeenCalled();

    const velho = pronto({
      movimento: '2026-09-01',
      primeiroCdi: '2026-08-01',
      ultimoCdi: '2026-10-02',
    });
    await velho.service.atualizarSeNecessario();
    expect(velho.gateway.buscar).toHaveBeenCalledTimes(1);
  });

  it('movimento mais antigo que o primeiro CDI gravado: busca o histórico que falta', async () => {
    const { gateway, service } = pronto({
      movimento: '2026-02-01',
      primeiroCdi: '2026-06-01',
      ultimoCdi: '2026-10-05',
    });

    await service.atualizarSeNecessario();

    expect(gateway.buscar).toHaveBeenCalledWith('2026-02-01', '2026-10-05');
  });

  it('BCB fora do ar: nunca lança e não insiste antes de 15 minutos', async () => {
    const { gateway, service } = pronto({ movimento: '2026-09-01' });
    gateway.buscar.mockRejectedValue(new CdiIndisponivelError());

    await expect(service.atualizarSeNecessario()).resolves.toBeUndefined();
    await service.atualizarSeNecessario();
    expect(gateway.buscar).toHaveBeenCalledTimes(1);

    jest.spyOn(Date, 'now').mockReturnValue(AGORA + 16 * 60 * 1000);
    await service.atualizarSeNecessario();
    expect(gateway.buscar).toHaveBeenCalledTimes(2);
  });

  it('chamadas simultâneas compartilham uma única busca', async () => {
    const { gateway, service } = pronto({ movimento: '2026-09-01' });

    await Promise.all([service.atualizarSeNecessario(), service.atualizarSeNecessario()]);

    expect(gateway.buscar).toHaveBeenCalledTimes(1);
  });

  it('espera no máximo o tempo dado e segue com o que tem (o boot não espera: 0)', async () => {
    const { gateway, service } = pronto({ movimento: '2026-09-01' });
    gateway.buscar.mockReturnValue(new Promise(() => undefined)); // nunca responde

    await expect(service.atualizarSeNecessario(20)).resolves.toBeUndefined();
    expect(gateway.buscar).toHaveBeenCalledTimes(1);
  });

  describe('a janela de 15 minutos só conta tentativa que de fato foi ao BCB (CA-25, regressão)', () => {
    it('checagem que conclui "não precisa" (sem movimento) NÃO consome a janela: o movimento que aparece logo depois dispara a busca', async () => {
      const { prisma, gateway, service } = pronto({ movimento: null });

      // ex.: um GET /carteira antes de existir qualquer Caixinha
      await service.atualizarSeNecessario();
      expect(gateway.buscar).not.toHaveBeenCalled();

      // o usuário cria a Caixinha e informa o saldo; o relógio não andou (mesmo instante)
      prisma.movimentoCaixinha.aggregate.mockResolvedValue({ _min: { data: d('2026-09-01') } });
      await service.atualizarSeNecessario();

      expect(gateway.buscar).toHaveBeenCalledTimes(1);
    });

    it('o boot sem movimento NÃO queima a janela: a primeira consulta com movimento busca o CDI', async () => {
      const { prisma, gateway, service } = pronto({ movimento: null });

      service.onApplicationBootstrap();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(gateway.buscar).not.toHaveBeenCalled();

      prisma.movimentoCaixinha.aggregate.mockResolvedValue({ _min: { data: d('2026-09-01') } });
      await service.atualizarSeNecessario();

      expect(gateway.buscar).toHaveBeenCalledTimes(1);
    });

    it('guarda: tentativa que FOI ao BCB e falhou continua respeitando os 15 minutos', async () => {
      const { gateway, service } = pronto({ movimento: '2026-09-01' });
      gateway.buscar.mockRejectedValue(new CdiIndisponivelError());

      await service.atualizarSeNecessario();
      await service.atualizarSeNecessario();

      expect(gateway.buscar).toHaveBeenCalledTimes(1);
    });
  });

  it('ao subir, tenta deixar o CDI em dia sem bloquear', async () => {
    const { gateway, service } = pronto({ movimento: '2026-09-01' });

    service.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(gateway.buscar).toHaveBeenCalledTimes(1);
  });
});
