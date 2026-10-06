import type { AvisoCarteira, AvisoEnvelopes, Envelope } from '@solidus/shared';

/** Uma Caixinha como a carteira a devolve (só o que os envelopes leem). */
export interface CaixinhaParaEnvelopes {
  ativa: boolean;
  reservaEmergencia: boolean;
  saldoLiquidoCentavos: number | null;
  saldoBrutoCentavos: number;
  avisos: readonly AvisoCarteira[];
}

/** Uma conta gravada pelo sync. O cartão NUNCA soma: seu saldo foi gravado cru, sem interpretar (spec 02). */
export interface ContaParaEnvelopes {
  tipo: 'CORRENTE' | 'POUPANCA' | 'CARTAO';
  saldoCentavos: number;
}

export interface EnvelopeEntrada {
  id: string;
  nome: string;
  alocadoCentavos: number;
  metaCentavos: number | null;
}

export interface EntradaEnvelopes {
  caixinhas: readonly CaixinhaParaEnvelopes[];
  contas: readonly ContaParaEnvelopes[];
  /** Meta da reserva de emergência (spec reserva-emergencia); 0 quando não há gasto para calcular. */
  reservaMetaCentavos: number;
  envelopes: readonly EnvelopeEntrada[];
}

export interface ResultadoEnvelopes {
  caixinhasCentavos: number;
  contaCorrenteCentavos: number;
  totalCentavos: number;
  reservaValorCentavos: number;
  reservaExcedenteCentavos: number;
  envelopes: Envelope[];
  totalAlocadoCentavos: number;
  livreCentavos: number;
  avisos: AvisoEnvelopes[];
}

/** Avisos da carteira que os envelopes repassam (RESGATE_ACIMA_DO_SALDO é detalhe da Caixinha). */
const AVISOS_REPASSADOS: readonly AvisoCarteira[] = [
  'CDI_DEFASADO',
  'SEM_SALDO_INFORMADO',
  'IMPOSTO_NAO_CONFIGURADO',
];

const ORDEM_AVISOS: readonly AvisoEnvelopes[] = [
  'ALOCADO_ACIMA_DO_DISPONIVEL',
  'FATURA_DO_CARTAO_NAO_DESCONTADA',
  'SEM_CONTA_SINCRONIZADA',
  'IMPOSTO_NAO_CONFIGURADO',
  'CDI_DEFASADO',
  'SEM_SALDO_INFORMADO',
];

/**
 * Valor REALIZÁVEL de uma Caixinha: o saldo líquido estimado (o que o usuário teria ao resgatar, depois de IR e
 * IOF); se o líquido é `null` (tabelas de imposto vazias), o bruto. É a mesma medida da reserva de emergência,
 * de propósito: os dois números se somam sem diferença de base.
 */
function valorRealizavel(c: CaixinhaParaEnvelopes): number {
  return c.saldoLiquidoCentavos ?? c.saldoBrutoCentavos;
}

/** Progresso do envelope em relação à meta (sem meta: tudo nulo). Só inteiros. */
export function progressoDoEnvelope(e: EnvelopeEntrada): Envelope {
  const { id, nome, alocadoCentavos, metaCentavos } = e;
  if (metaCentavos === null || metaCentavos <= 0) {
    return {
      id,
      nome,
      alocadoCentavos,
      metaCentavos: null,
      progressoBp: null,
      faltaCentavos: null,
      atingida: false,
    };
  }
  return {
    id,
    nome,
    alocadoCentavos,
    metaCentavos,
    progressoBp: Math.floor((alocadoCentavos * 10_000) / metaCentavos),
    faltaCentavos: Math.max(0, metaCentavos - alocadoCentavos),
    atingida: alocadoCentavos >= metaCentavos,
  };
}

/**
 * Calcula os envelopes (spec envelopes). Pura, em centavos inteiros, sem relógio nem banco.
 * `livre = total − reserva − Σ alocado` e PODE ser negativo: o app avisa, nunca esconde nem recusa.
 */
export function calcularEnvelopes(entrada: EntradaEnvelopes): ResultadoEnvelopes {
  const avisos = new Set<AvisoEnvelopes>();

  const ativas = entrada.caixinhas.filter((c) => c.ativa);
  const caixinhas = ativas.reduce((soma, c) => soma + valorRealizavel(c), 0);
  for (const c of ativas) {
    if (c.saldoLiquidoCentavos === null) avisos.add('IMPOSTO_NAO_CONFIGURADO');
    for (const a of c.avisos) {
      if (AVISOS_REPASSADOS.includes(a)) avisos.add(a as AvisoEnvelopes);
    }
  }

  // Só conta bancária soma. O cartão não: o saldo dele não foi interpretado (fatura/limite), só avisamos.
  const bancarias = entrada.contas.filter((c) => c.tipo === 'CORRENTE' || c.tipo === 'POUPANCA');
  const contaCorrente = bancarias.reduce((soma, c) => soma + c.saldoCentavos, 0);
  if (bancarias.length === 0) avisos.add('SEM_CONTA_SINCRONIZADA');
  if (entrada.contas.some((c) => c.tipo === 'CARTAO' && c.saldoCentavos !== 0)) {
    avisos.add('FATURA_DO_CARTAO_NAO_DESCONTADA');
  }

  // A reserva entra INTEIRA, mesmo acima da meta (o "livre" nunca é exagerado); o excedente é só informação.
  const reserva = ativas
    .filter((c) => c.reservaEmergencia)
    .reduce((soma, c) => soma + valorRealizavel(c), 0);
  const excedente =
    entrada.reservaMetaCentavos > 0 ? Math.max(0, reserva - entrada.reservaMetaCentavos) : 0;

  const envelopes = entrada.envelopes.map(progressoDoEnvelope);
  const totalAlocado = envelopes.reduce((soma, e) => soma + e.alocadoCentavos, 0);
  const total = caixinhas + contaCorrente;
  const livre = total - reserva - totalAlocado;
  if (livre < 0) avisos.add('ALOCADO_ACIMA_DO_DISPONIVEL');

  return {
    caixinhasCentavos: caixinhas,
    contaCorrenteCentavos: contaCorrente,
    totalCentavos: total,
    reservaValorCentavos: reserva,
    reservaExcedenteCentavos: excedente,
    envelopes,
    totalAlocadoCentavos: totalAlocado,
    livreCentavos: livre,
    avisos: ORDEM_AVISOS.filter((a) => avisos.has(a)),
  };
}
