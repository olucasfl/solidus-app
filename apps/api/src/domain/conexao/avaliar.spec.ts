import {
  CONSENTIMENTO_ATENCAO_DIAS,
  CONSENTIMENTO_CRITICO_DIAS,
  DADOS_ATENCAO_DIAS,
  DADOS_CRITICO_DIAS,
  SYNC_ATENCAO_DIAS,
  SYNC_CRITICO_DIAS,
} from './limites';
import { avaliarConexao, type RetratoConexao } from './avaliar';

// Dados 100% sintéticos (RULES §8). O relógio é injetado: nada depende de "hoje".
const AGORA = new Date('2026-10-06T12:00:00.000Z');
const DIA = 24 * 60 * 60 * 1000;
const emDias = (n: number) => new Date(AGORA.getTime() + n * DIA);
const haDias = (n: number) => emDias(-n);

/** Um retrato saudável; cada teste estraga só o que quer provar. */
function retrato(parcial: Partial<RetratoConexao> = {}): RetratoConexao {
  return {
    statusItem: 'UPDATED',
    consentimentoExpiraEm: emDias(200),
    ultimaAtualizacaoEm: haDias(0),
    autoSyncDesativadoEm: null,
    acaoPendente: false,
    verificadoEm: AGORA,
    erroVerificacao: null,
    ...parcial,
  };
}

const codigos = (r: RetratoConexao | null) => avaliarConexao(r, AGORA).avisos.map((a) => a.codigo);
const unico = (r: RetratoConexao | null) => {
  const { avisos } = avaliarConexao(r, AGORA);
  expect(avisos).toHaveLength(1);
  return avisos[0]!;
};

describe('avaliarConexao', () => {
  it('CA-01: item saudável → OK e nenhum aviso', () => {
    expect(avaliarConexao(retrato(), AGORA)).toEqual({ situacao: 'OK', avisos: [] });
  });

  describe('consentimento', () => {
    it.each([
      [31, null],
      [30, 'ATENCAO'],
      [8, 'ATENCAO'],
      [7, 'CRITICO'],
      [1, 'CRITICO'],
    ] as const)('CA-02: faltam %i dias → %s', (dias, severidade) => {
      const r = retrato({ consentimentoExpiraEm: emDias(dias) });
      if (severidade === null) {
        expect(codigos(r)).toEqual([]);
      } else {
        expect(unico(r)).toEqual({
          codigo: 'CONSENTIMENTO_EXPIRA_EM_BREVE',
          severidade,
          acao: 'REAUTORIZAR_NO_MEU_PLUGGY',
          dias,
        });
      }
    });

    it('CA-02: expira hoje mais tarde (0 dias de calendário) ainda é "em breve" e CRITICO', () => {
      const a = unico(retrato({ consentimentoExpiraEm: new Date('2026-10-06T23:00:00.000Z') }));
      expect(a).toMatchObject({
        codigo: 'CONSENTIMENTO_EXPIRA_EM_BREVE',
        severidade: 'CRITICO',
        dias: 0,
      });
    });

    it('CA-03: já vencido → CONSENTIMENTO_EXPIRADO CRITICO e NÃO também "expira em breve"', () => {
      const r = retrato({ consentimentoExpiraEm: haDias(1) });
      expect(unico(r)).toEqual({
        codigo: 'CONSENTIMENTO_EXPIRADO',
        severidade: 'CRITICO',
        acao: 'REAUTORIZAR_NO_MEU_PLUGGY',
        dias: null,
      });
    });

    it('vence exatamente agora → já está expirado', () => {
      expect(codigos(retrato({ consentimentoExpiraEm: AGORA }))).toEqual([
        'CONSENTIMENTO_EXPIRADO',
      ]);
    });

    it('sem data de consentimento (conector que não é Open Finance) → nenhum aviso de consentimento', () => {
      expect(codigos(retrato({ consentimentoExpiraEm: null }))).toEqual([]);
    });
  });

  describe('estado do item', () => {
    it.each(['LOGIN_ERROR', 'WAITING_USER_INPUT', 'WAITING_USER_ACTION'])(
      'CA-04: status %s → CONEXAO_PRECISA_DE_VOCE CRITICO, com a ação de reautorizar',
      (statusItem) => {
        expect(unico(retrato({ statusItem }))).toEqual({
          codigo: 'CONEXAO_PRECISA_DE_VOCE',
          severidade: 'CRITICO',
          acao: 'REAUTORIZAR_NO_MEU_PLUGGY',
          dias: null,
        });
      },
    );

    it('CA-04: ação pendente (userAction) com status UPDATED também pede o usuário', () => {
      expect(codigos(retrato({ acaoPendente: true }))).toEqual(['CONEXAO_PRECISA_DE_VOCE']);
    });

    it('CA-04: OUTDATED → ULTIMA_ATUALIZACAO_FALHOU, só ATENCAO (pode tentar de novo)', () => {
      expect(unico(retrato({ statusItem: 'OUTDATED' }))).toEqual({
        codigo: 'ULTIMA_ATUALIZACAO_FALHOU',
        severidade: 'ATENCAO',
        acao: null,
        dias: null,
      });
    });

    it.each(['UPDATING', 'MERGING', null])(
      'CA-04: status %s (em andamento/desconhecido) não gera aviso',
      (statusItem) => {
        expect(codigos(retrato({ statusItem }))).toEqual([]);
      },
    );

    it('status que pede o usuário não duplica com OUTDATED nem com a ação pendente', () => {
      expect(codigos(retrato({ statusItem: 'LOGIN_ERROR', acaoPendente: true }))).toEqual([
        'CONEXAO_PRECISA_DE_VOCE',
      ]);
    });
  });

  it('CA-05: autoSyncDisabledAt preenchido → AUTO_SYNC_DESATIVADO CRITICO', () => {
    expect(unico(retrato({ autoSyncDesativadoEm: haDias(1) }))).toMatchObject({
      codigo: 'AUTO_SYNC_DESATIVADO',
      severidade: 'CRITICO',
    });
  });

  describe('dado velho do lado do Pluggy', () => {
    it.each([
      [0, null],
      [2, null],
      [3, 'ATENCAO'],
      [7, 'ATENCAO'],
      [8, 'CRITICO'],
    ] as const)('CA-06: atualizado há %i dias → %s', (dias, severidade) => {
      const r = retrato({ ultimaAtualizacaoEm: haDias(dias) });
      if (severidade === null) {
        expect(codigos(r)).toEqual([]);
      } else {
        expect(unico(r)).toEqual({ codigo: 'DADOS_DESATUALIZADOS', severidade, acao: null, dias });
      }
    });

    it('item sem nenhuma coleta registrada (lastUpdatedAt nulo) → DADOS_DESATUALIZADOS ATENCAO sem dias', () => {
      expect(unico(retrato({ ultimaAtualizacaoEm: null }))).toEqual({
        codigo: 'DADOS_DESATUALIZADOS',
        severidade: 'ATENCAO',
        acao: null,
        dias: null,
      });
    });
  });

  describe('sync do próprio Solidus parado', () => {
    it.each([
      [2, null],
      [3, 'ATENCAO'],
      [7, 'ATENCAO'],
      [8, 'CRITICO'],
    ] as const)('CA-07: última leitura há %i dias → %s', (dias, severidade) => {
      const r = retrato({ verificadoEm: haDias(dias) });
      if (severidade === null) {
        expect(codigos(r)).toEqual([]);
      } else {
        expect(unico(r)).toEqual({
          codigo: 'SYNC_DO_SOLIDUS_PARADO',
          severidade,
          acao: 'VERIFICAR_AGENDADOR_DO_SYNC',
          dias,
        });
      }
    });

    it('nunca leu o item com sucesso (verificadoEm nulo): não inventa "sync parado"', () => {
      expect(codigos(retrato({ verificadoEm: null }))).toEqual([]);
    });
  });

  it('CA-10: erro na última leitura → PLUGGY_INDISPONIVEL ATENCAO', () => {
    expect(unico(retrato({ erroVerificacao: 'PLUGGY_INDISPONIVEL' }))).toEqual({
      codigo: 'PLUGGY_INDISPONIVEL',
      severidade: 'ATENCAO',
      acao: null,
      dias: null,
    });
  });

  it('CA-09: sem retrato → ATENCAO com NUNCA_SINCRONIZADO (não é erro)', () => {
    expect(avaliarConexao(null, AGORA)).toEqual({
      situacao: 'ATENCAO',
      avisos: [{ codigo: 'NUNCA_SINCRONIZADO', severidade: 'ATENCAO', acao: null, dias: null }],
    });
  });

  describe('situação e ordem', () => {
    it('CA-08: a situação é a PIOR severidade e os avisos saem do mais grave ao menos grave', () => {
      const r = retrato({
        statusItem: 'OUTDATED', // ATENCAO
        ultimaAtualizacaoEm: haDias(3), // ATENCAO
        consentimentoExpiraEm: emDias(5), // CRITICO
        erroVerificacao: 'PLUGGY_INDISPONIVEL', // ATENCAO
      });
      const { situacao, avisos } = avaliarConexao(r, AGORA);

      expect(situacao).toBe('CRITICO');
      expect(avisos.map((a) => a.severidade)).toEqual(['CRITICO', 'ATENCAO', 'ATENCAO', 'ATENCAO']);
      expect(avisos.map((a) => a.codigo)).toEqual([
        'CONSENTIMENTO_EXPIRA_EM_BREVE',
        'ULTIMA_ATUALIZACAO_FALHOU',
        'DADOS_DESATUALIZADOS',
        'PLUGGY_INDISPONIVEL',
      ]);
    });

    it('só avisos de ATENCAO → situação ATENCAO', () => {
      expect(avaliarConexao(retrato({ statusItem: 'OUTDATED' }), AGORA).situacao).toBe('ATENCAO');
    });

    it('a ordem é estável (mesma entrada, mesma saída) e a avaliação não altera o retrato', () => {
      const r = retrato({ statusItem: 'LOGIN_ERROR', ultimaAtualizacaoEm: haDias(9) });
      const copia = JSON.stringify(r);

      expect(avaliarConexao(r, AGORA)).toEqual(avaliarConexao(r, AGORA));
      expect(JSON.stringify(r)).toBe(copia);
    });
  });

  it('os limites estão onde a spec diz (30 e 7 de consentimento; 2 e 7 de atraso, dos dois lados)', () => {
    expect([CONSENTIMENTO_ATENCAO_DIAS, CONSENTIMENTO_CRITICO_DIAS]).toEqual([30, 7]);
    expect([DADOS_ATENCAO_DIAS, DADOS_CRITICO_DIAS]).toEqual([2, 7]);
    expect([SYNC_ATENCAO_DIAS, SYNC_CRITICO_DIAS]).toEqual([2, 7]);
  });
});
