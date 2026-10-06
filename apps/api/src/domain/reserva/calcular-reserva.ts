import type {
  AvisoCarteira,
  AvisoReserva,
  BaseGastoReserva,
  CaixinhaDaReserva,
  ConfiguracaoReserva,
  MesDeGastoReserva,
} from '@solidus/shared';

/** Um mês FECHADO da janela, como a poupança o devolve. `transacoes` decide se o mês já tinha dados. */
export interface MesDaJanela {
  mes: string;
  brutoCentavos: number;
  liquidoCentavos: number;
  transacoes: number;
}

/** Uma Caixinha ATIVA marcada como reserva de emergência, como a carteira a devolve. */
export interface CaixinhaMarcada {
  id: string;
  nome: string;
  saldoLiquidoCentavos: number | null;
  saldoBrutoCentavos: number;
  avisos: readonly AvisoCarteira[];
}

export interface EntradaReserva {
  /** Os últimos meses FECHADOS (mais antigo primeiro). Já filtrados pela janela. */
  mesesDaJanela: readonly MesDaJanela[];
  caixinhasMarcadas: readonly CaixinhaMarcada[];
  configuracao: ConfiguracaoReserva;
}

export interface ResultadoReserva {
  mesesConsiderados: MesDeGastoReserva[];
  mediaMensalBrutaCentavos: number;
  mediaMensalLiquidaCentavos: number;
  mediaMensalCentavos: number;
  baseUsada: BaseGastoReserva;
  metaCentavos: number;
  saldoCentavos: number;
  caixinhas: CaixinhaDaReserva[];
  faltaCentavos: number;
  coberturaMesesCentesimos: number | null;
  atingida: boolean;
  avisos: AvisoReserva[];
}

/** Avisos da carteira que a reserva repassa (RESGATE_ACIMA_DO_SALDO é detalhe da Caixinha, não da reserva). */
const AVISOS_REPASSADOS: readonly AvisoCarteira[] = [
  'IMPOSTO_NAO_CONFIGURADO',
  'CDI_DEFASADO',
  'SEM_SALDO_INFORMADO',
];

const ORDEM_AVISOS: readonly AvisoReserva[] = [
  'NENHUMA_CAIXINHA_MARCADA',
  'SEM_GASTOS_NA_JANELA',
  'HISTORICO_CURTO',
  'IMPOSTO_NAO_CONFIGURADO',
  'CDI_DEFASADO',
  'SEM_SALDO_INFORMADO',
];

/**
 * Média PARA CIMA, em inteiros: `⌈soma / n⌉` sem divisão em ponto flutuante. Reserva de emergência é um
 * número em que é melhor errar para o lado seguro (spec reserva-emergencia, "Suposições").
 */
export function mediaParaCima(somaCentavos: number, quantidade: number): number {
  if (quantidade <= 0 || somaCentavos <= 0) return 0;
  return Math.floor((somaCentavos + quantidade - 1) / quantidade);
}

/**
 * Só entram os meses a partir do PRIMEIRO que tem alguma transação: um mês anterior ao início dos dados
 * não é "um mês sem gasto" (puxaria a média para baixo e a meta ficaria pequena demais).
 */
export function mesesComDados(meses: readonly MesDaJanela[]): MesDaJanela[] {
  const primeiro = meses.findIndex((m) => m.transacoes > 0);
  return primeiro < 0 ? [] : meses.slice(primeiro);
}

/** Uma despesa nunca é negativa para a reserva (um estorno maior que o gasto do mês vale 0, não crédito). */
function naoNegativo(centavos: number): number {
  return Math.max(0, centavos);
}

/**
 * Calcula a reserva de emergência (spec reserva-emergencia). Pura, em centavos inteiros: nenhuma divisão em
 * ponto flutuante, e o relógio e o banco ficam de fora. `meta = média × meses`; `cobertura` em centésimos de mês.
 */
export function calcularReserva(entrada: EntradaReserva): ResultadoReserva {
  const { configuracao: config } = entrada;
  const avisos = new Set<AvisoReserva>();

  const considerados = mesesComDados(entrada.mesesDaJanela).map((m) => ({
    mes: m.mes,
    brutoCentavos: naoNegativo(m.brutoCentavos),
    liquidoCentavos: naoNegativo(m.liquidoCentavos),
  }));
  const n = considerados.length;
  const mediaBruta = mediaParaCima(
    considerados.reduce((soma, m) => soma + m.brutoCentavos, 0),
    n,
  );
  const mediaLiquida = mediaParaCima(
    considerados.reduce((soma, m) => soma + m.liquidoCentavos, 0),
    n,
  );
  const media = config.base === 'BRUTA' ? mediaBruta : mediaLiquida;

  if (n === 0 || media === 0) {
    avisos.add('SEM_GASTOS_NA_JANELA');
  } else if (n < config.janelaMeses) {
    avisos.add('HISTORICO_CURTO');
  }

  // Saldo: líquido estimado (o que o usuário teria ao resgatar); o bruto só quando o imposto não está configurado.
  const caixinhas: CaixinhaDaReserva[] = entrada.caixinhasMarcadas.map((c) => {
    const usaLiquido = c.saldoLiquidoCentavos !== null;
    if (!usaLiquido) avisos.add('IMPOSTO_NAO_CONFIGURADO');
    for (const a of c.avisos) {
      if (AVISOS_REPASSADOS.includes(a)) avisos.add(a as AvisoReserva);
    }
    return {
      id: c.id,
      nome: c.nome,
      saldoCentavos: usaLiquido ? (c.saldoLiquidoCentavos as number) : c.saldoBrutoCentavos,
      baseDoSaldo: usaLiquido ? 'LIQUIDO_ESTIMADO' : 'BRUTO_ESTIMADO',
    };
  });
  if (caixinhas.length === 0) avisos.add('NENHUMA_CAIXINHA_MARCADA');

  const saldo = caixinhas.reduce((soma, c) => soma + c.saldoCentavos, 0);
  const meta = media * config.meses;
  const falta = Math.max(0, meta - saldo);

  return {
    mesesConsiderados: considerados,
    mediaMensalBrutaCentavos: mediaBruta,
    mediaMensalLiquidaCentavos: mediaLiquida,
    mediaMensalCentavos: media,
    baseUsada: config.base,
    metaCentavos: meta,
    saldoCentavos: saldo,
    caixinhas,
    faltaCentavos: falta,
    coberturaMesesCentesimos: media > 0 ? Math.floor((saldo * 100) / media) : null,
    atingida: meta > 0 && saldo >= meta,
    avisos: ORDEM_AVISOS.filter((a) => avisos.has(a)),
  };
}
