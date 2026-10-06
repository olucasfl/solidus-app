import { mapearItem } from './item';

describe('mapearItem', () => {
  it('mapeia status, datas e contadores do item', () => {
    const item = mapearItem({
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      consentExpiresAt: new Date('2027-10-02T13:30:35.052Z'),
      lastUpdatedAt: '2026-10-02T12:37:09.306Z',
      nextAutoSyncAt: new Date('2026-10-03T14:06:00.000Z'),
      autoSyncDisabledAt: null,
      consecutiveFailedLoginAttempts: 0,
      userAction: null,
    });

    expect(item).toEqual({
      statusItem: 'UPDATED',
      statusExecucao: 'SUCCESS',
      consentimentoExpiraEm: new Date('2027-10-02T13:30:35.052Z'),
      ultimaAtualizacaoEm: new Date('2026-10-02T12:37:09.306Z'),
      proximaAtualizacaoEm: new Date('2026-10-03T14:06:00.000Z'),
      autoSyncDesativadoEm: null,
      falhasDeLogin: 0,
      acaoPendente: false,
    });
  });

  it('CA-11: nunca devolve texto livre do Pluggy (error, statusDetail, conteúdo de userAction)', () => {
    const item = mapearItem({
      status: 'WAITING_USER_ACTION',
      userAction: { url: 'https://exemplo.invalido/autorizar?codigo=SEGREDO-123' },
      // campos extras que a resposta real traz e que NÃO podem passar adiante:
      ...({
        error: { message: 'mensagem do banco com dado sensivel' },
        statusDetail: { texto: 'detalhe livre' },
      } as object),
    });

    const serializado = JSON.stringify(item);
    expect(serializado).not.toContain('SEGREDO-123');
    expect(serializado).not.toContain('exemplo.invalido');
    expect(serializado).not.toContain('mensagem do banco');
    expect(serializado).not.toContain('detalhe livre');
    expect(item.acaoPendente).toBe(true);
    expect(Object.keys(item).sort()).toEqual(
      [
        'acaoPendente',
        'autoSyncDesativadoEm',
        'consentimentoExpiraEm',
        'falhasDeLogin',
        'proximaAtualizacaoEm',
        'statusExecucao',
        'statusItem',
        'ultimaAtualizacaoEm',
      ].sort(),
    );
  });

  it('campos ausentes viram null; userAction ausente ou nulo não é ação pendente', () => {
    expect(mapearItem({ status: 'UPDATING' })).toEqual({
      statusItem: 'UPDATING',
      statusExecucao: null,
      consentimentoExpiraEm: null,
      ultimaAtualizacaoEm: null,
      proximaAtualizacaoEm: null,
      autoSyncDesativadoEm: null,
      falhasDeLogin: null,
      acaoPendente: false,
    });
    expect(mapearItem({ status: 'UPDATED', userAction: null }).acaoPendente).toBe(false);
  });

  it('data inválida vira null em vez de "Invalid Date" (nunca grava lixo no banco)', () => {
    const item = mapearItem({ status: 'UPDATED', consentExpiresAt: 'isto-nao-e-data' });
    expect(item.consentimentoExpiraEm).toBeNull();
  });

  it('status e execução são cortados no tamanho da coluna', () => {
    const item = mapearItem({ status: 'X'.repeat(80), executionStatus: 'Y'.repeat(80) });
    expect(item.statusItem).toHaveLength(40);
    expect(item.statusExecucao).toHaveLength(40);
  });
});
