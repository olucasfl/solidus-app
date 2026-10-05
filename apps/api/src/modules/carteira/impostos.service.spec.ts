import { PrismaService } from '../../database/prisma.service';
import { ImpostosService } from './impostos.service';

function montar() {
  const prisma = {
    faixaImposto: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockReturnValue('delete'),
      createMany: jest.fn().mockReturnValue('create'),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { prisma, service: new ImpostosService(prisma as unknown as PrismaService) };
}

describe('ImpostosService (CA-17)', () => {
  it('lista cada tabela ordenada por idade, com a faixa sem limite por último', async () => {
    const { prisma, service } = montar();
    prisma.faixaImposto.findMany.mockResolvedValue([
      { tipo: 'IR', ateDias: null, aliquotaBp: 1_500 },
      { tipo: 'IR', ateDias: 360, aliquotaBp: 2_000 },
      { tipo: 'IR', ateDias: 180, aliquotaBp: 2_250 },
    ]);

    const r = await service.faixas('IR');

    expect(r).toEqual([
      { ateDias: 180, aliquotaBp: 2_250 },
      { ateDias: 360, aliquotaBp: 2_000 },
      { ateDias: null, aliquotaBp: 1_500 },
    ]);
  });

  it('tabela válida substitui a anterior numa transação (apaga e recria o mesmo tipo)', async () => {
    const { prisma, service } = montar();

    const r = await service.substituir('IR', [
      { ateDias: 360, aliquotaBp: 2_000 },
      { ateDias: null, aliquotaBp: 1_500 },
    ]);

    expect(prisma.$transaction).toHaveBeenCalledWith(['delete', 'create']);
    expect(prisma.faixaImposto.deleteMany).toHaveBeenCalledWith({ where: { tipo: 'IR' } });
    expect(prisma.faixaImposto.createMany).toHaveBeenCalledWith({
      data: [
        { tipo: 'IR', ateDias: 360, aliquotaBp: 2_000 },
        { tipo: 'IR', ateDias: null, aliquotaBp: 1_500 },
      ],
    });
    expect(r).toHaveLength(2);
  });

  it.each([
    [
      'fora de ordem',
      [
        { ateDias: 360, aliquotaBp: 1 },
        { ateDias: 180, aliquotaBp: 1 },
      ],
    ],
    [
      'repetida',
      [
        { ateDias: 180, aliquotaBp: 1 },
        { ateDias: 180, aliquotaBp: 2 },
      ],
    ],
    ['alíquota acima de 100%', [{ ateDias: 180, aliquotaBp: 10_001 }]],
    ['alíquota negativa', [{ ateDias: 180, aliquotaBp: -1 }]],
    ['alíquota fracionária', [{ ateDias: 180, aliquotaBp: 12.5 }]],
    [
      '"sem limite" fora da última',
      [
        { ateDias: null, aliquotaBp: 1 },
        { ateDias: 180, aliquotaBp: 1 },
      ],
    ],
    ['dias zero', [{ ateDias: 0, aliquotaBp: 1 }]],
  ])('%s → 400 FAIXAS_INVALIDAS e a tabela anterior permanece intacta', async (_nome, faixas) => {
    const { prisma, service } = montar();

    await expect(service.substituir('IOF', faixas)).rejects.toMatchObject({
      response: { code: 'FAIXAS_INVALIDAS' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('tabela vazia é válida (limpa a configuração)', async () => {
    const { prisma, service } = montar();

    await expect(service.substituir('IOF', [])).resolves.toEqual([]);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
