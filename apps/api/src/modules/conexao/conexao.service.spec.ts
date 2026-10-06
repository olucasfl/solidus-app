import { type ItemPluggy } from '../../domain/conexao/item';
import { PrismaService } from '../../database/prisma.service';
import { type PluggyGateway } from '../sync/pluggy.gateway';
import { PluggyIndisponivelError } from '../sync/sync-errors';
import { ConexaoService } from './conexao.service';

// Dados 100% sintéticos (RULES §8).
const U = 'user-1';
const ITEM_ID = 'item-sintetico-1';
const AGORA = new Date('2026-10-06T12:00:00.000Z');

function item(parcial: Partial<ItemPluggy> = {}): ItemPluggy {
  return {
    statusItem: 'UPDATED',
    statusExecucao: 'SUCCESS',
    consentimentoExpiraEm: new Date('2027-10-02T13:30:35.052Z'),
    ultimaAtualizacaoEm: new Date('2026-10-06T08:00:00.000Z'),
    proximaAtualizacaoEm: new Date('2026-10-07T14:00:00.000Z'),
    autoSyncDesativadoEm: null,
    falhasDeLogin: 0,
    acaoPendente: false,
    ...parcial,
  };
}

function montar() {
  const prisma = {
    conexaoPluggy: {
      upsert: jest.fn().mockResolvedValue(undefined),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const gateway = { listarItem: jest.fn().mockResolvedValue(item()) };
  const service = new ConexaoService(
    prisma as unknown as PrismaService,
    gateway as unknown as PluggyGateway,
  );
  return { prisma, gateway, service };
}

/** O que o banco devolveria para um retrato saudável de ontem. */
function linha(parcial: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    userId: U,
    itemId: ITEM_ID,
    statusItem: 'UPDATED',
    statusExecucao: 'SUCCESS',
    consentimentoExpiraEm: new Date('2027-10-02T13:30:35.052Z'),
    ultimaAtualizacaoEm: new Date('2026-10-06T08:00:00.000Z'),
    proximaAtualizacaoEm: null,
    autoSyncDesativadoEm: null,
    falhasDeLogin: 0,
    acaoPendente: false,
    verificadoEm: new Date('2026-10-06T09:00:00.000Z'),
    erroVerificacao: null,
    atualizadoEm: AGORA,
    ...parcial,
  };
}

describe('ConexaoService.registrar', () => {
  it('CA-10: grava o retrato do item com a leitura bem-sucedida, do usuário certo', async () => {
    const { prisma, gateway, service } = montar();

    await service.registrar(U, ITEM_ID);

    expect(gateway.listarItem).toHaveBeenCalledWith(ITEM_ID);
    const chamada = prisma.conexaoPluggy.upsert.mock.calls[0]![0];
    expect(chamada.where).toEqual({ userId: U });
    expect(chamada.create).toMatchObject({
      userId: U,
      itemId: ITEM_ID,
      statusItem: 'UPDATED',
      statusExecucao: 'SUCCESS',
      consentimentoExpiraEm: new Date('2027-10-02T13:30:35.052Z'),
      ultimaAtualizacaoEm: new Date('2026-10-06T08:00:00.000Z'),
      acaoPendente: false,
      erroVerificacao: null,
    });
    expect(chamada.create.verificadoEm).toBeInstanceOf(Date);
  });

  it('CA-10: só códigos e datas são gravados: nenhum campo de texto livre do Pluggy chega ao upsert', async () => {
    const { prisma, gateway, service } = montar();
    // mesmo que o gateway devolvesse algo a mais, o tipo do item só tem códigos/datas/booleanos
    gateway.listarItem.mockResolvedValue({
      ...item({ statusItem: 'WAITING_USER_ACTION', acaoPendente: true }),
      error: { message: 'mensagem do banco' },
      statusDetail: { texto: 'detalhe' },
    });

    await service.registrar(U, ITEM_ID);

    const gravado = JSON.stringify(prisma.conexaoPluggy.upsert.mock.calls[0]![0]);
    expect(gravado).not.toContain('mensagem do banco');
    expect(gravado).not.toContain('detalhe');
    expect(prisma.conexaoPluggy.upsert.mock.calls[0]![0].create.acaoPendente).toBe(true);
  });

  it('CA-11: leitura do item falhando NÃO lança, mantém o retrato anterior e só marca erroVerificacao', async () => {
    const { prisma, gateway, service } = montar();
    gateway.listarItem.mockRejectedValue(new PluggyIndisponivelError());

    await expect(service.registrar(U, ITEM_ID)).resolves.toBeUndefined();

    const chamada = prisma.conexaoPluggy.upsert.mock.calls[0]![0];
    expect(chamada.where).toEqual({ userId: U });
    // o `update` não mexe em status/datas: o retrato anterior fica como estava
    expect(chamada.update).toEqual({ erroVerificacao: 'PLUGGY_INDISPONIVEL' });
    expect(chamada.create).toEqual({
      userId: U,
      itemId: ITEM_ID,
      erroVerificacao: 'PLUGGY_INDISPONIVEL',
    });
  });

  it('CA-12: a próxima leitura bem-sucedida LIMPA o erro e atualiza verificadoEm', async () => {
    const { prisma, service } = montar();

    await service.registrar(U, ITEM_ID);

    const { update } = prisma.conexaoPluggy.upsert.mock.calls[0]![0];
    expect(update.erroVerificacao).toBeNull();
    expect(update.verificadoEm).toBeInstanceOf(Date);
  });

  it('falha ao GRAVAR o retrato (banco) não derruba o sync e não vira "Pluggy indisponível"', async () => {
    const { prisma, service } = montar();
    prisma.conexaoPluggy.upsert.mockRejectedValue(new Error('banco fora'));

    await expect(service.registrar(U, ITEM_ID)).resolves.toBeUndefined();
    // só 1 tentativa de gravar: o erro de banco NÃO é registrado como erro do Pluggy
    expect(prisma.conexaoPluggy.upsert).toHaveBeenCalledTimes(1);
  });

  it('falha ao gravar também o erro de verificação (banco fora) continua não lançando', async () => {
    const { prisma, gateway, service } = montar();
    gateway.listarItem.mockRejectedValue(new PluggyIndisponivelError());
    prisma.conexaoPluggy.upsert.mockRejectedValue(new Error('banco fora'));

    await expect(service.registrar(U, ITEM_ID)).resolves.toBeUndefined();
  });
});

describe('ConexaoService.obter', () => {
  it('CA-09: sem retrato → 200 com conexao null, situação ATENCAO e NUNCA_SINCRONIZADO', async () => {
    const { service } = montar();

    expect(await service.obter(U, AGORA)).toEqual({
      situacao: 'ATENCAO',
      avisos: [{ codigo: 'NUNCA_SINCRONIZADO', severidade: 'ATENCAO', acao: null, dias: null }],
      conexao: null,
      calculadoEm: '2026-10-06T12:00:00.000Z',
    });
  });

  it('CA-01: retrato saudável → OK, datas em ISO 8601 e só o que a spec expõe', async () => {
    const { prisma, service } = montar();
    prisma.conexaoPluggy.findUnique.mockResolvedValue(linha());

    expect(await service.obter(U, AGORA)).toEqual({
      situacao: 'OK',
      avisos: [],
      conexao: {
        status: 'UPDATED',
        consentimentoExpiraEm: '2027-10-02T13:30:35.052Z',
        ultimaAtualizacaoEm: '2026-10-06T08:00:00.000Z',
        verificadoEm: '2026-10-06T09:00:00.000Z',
      },
      calculadoEm: '2026-10-06T12:00:00.000Z',
    });
  });

  it('CA-13: a resposta NUNCA contém o itemId', async () => {
    const { prisma, service } = montar();
    prisma.conexaoPluggy.findUnique.mockResolvedValue(linha());

    const json = JSON.stringify(await service.obter(U, AGORA));

    expect(json).not.toContain(ITEM_ID);
    expect(json).not.toContain('itemId');
  });

  it('a avaliação usa o "agora" injetado: consentimento em 5 dias → CRITICO', async () => {
    const { prisma, service } = montar();
    prisma.conexaoPluggy.findUnique.mockResolvedValue(
      linha({ consentimentoExpiraEm: new Date('2026-10-11T12:00:00.000Z') }),
    );

    const r = await service.obter(U, AGORA);

    expect(r.situacao).toBe('CRITICO');
    expect(r.avisos[0]).toMatchObject({ codigo: 'CONSENTIMENTO_EXPIRA_EM_BREVE', dias: 5 });
  });

  it('CA-14: consulta só o retrato do usuário da sessão', async () => {
    const { prisma, service } = montar();

    await service.obter('user-b', AGORA);

    expect(prisma.conexaoPluggy.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-b' } });
  });

  it('é só leitura: obter não chama o Pluggy nem grava nada', async () => {
    const { prisma, gateway, service } = montar();

    await service.obter(U, AGORA);

    expect(gateway.listarItem).not.toHaveBeenCalled();
    expect(prisma.conexaoPluggy.upsert).not.toHaveBeenCalled();
  });
});
