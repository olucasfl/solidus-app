import { type DataIso } from './datas';
import {
  type ConvencaoRendimento,
  type Movimento,
  projetarCaixinha,
  type ParametrosProjecao,
} from './projetar';

export interface Comparacao {
  /** SALDO anterior, de onde a estimativa parte. */
  de: DataIso;
  /** SALDO seguinte, o que o usuário informou ("a verdade vista no app do banco"). */
  ate: DataIso;
  informadoCentavos: number;
  estimadoCentavos: number;
  /** informado − estimado: positivo = o banco pagou mais do que o app estimou. */
  diferencaCentavos: number;
}

export interface ConferenciaPorConvencao {
  convencao: ConvencaoRendimento;
  comparacoes: Comparacao[];
  erroAbsolutoTotalCentavos: number;
}

export interface Conferencia {
  porConvencao: ConferenciaPorConvencao[];
  /** A de menor erro total; `null` se ainda não há dois saldos informados para comparar. */
  convencaoSugerida: ConvencaoRendimento | null;
}

const CONVENCOES: readonly ConvencaoRendimento[] = [
  'MOVIMENTO_ANTES_DO_RENDIMENTO',
  'MOVIMENTO_DEPOIS_DO_RENDIMENTO',
];

type Base = Pick<ParametrosProjecao, 'percentualCdiBp' | 'cdi'> & {
  movimentos: readonly Movimento[];
};

/**
 * Compara, para cada par de SALDOs consecutivos, o que o app ESTIMARIA para o segundo (partindo do
 * primeiro, com os aportes/resgates do meio) com o que o usuário de fato informou. Sem trabalho extra
 * do usuário: os saldos que ele já informa viram a verificação. Roda as duas convenções e sugere a
 * que erra menos. Não usa impostos (a comparação é de saldo BRUTO).
 */
export function conferirCaixinha(p: Base): Conferencia {
  const indicesDeSaldo = p.movimentos.flatMap((m, i) => (m.tipo === 'SALDO' ? [i] : []));

  const porConvencao = CONVENCOES.map((convencao): ConferenciaPorConvencao => {
    const comparacoes: Comparacao[] = [];

    for (let k = 1; k < indicesDeSaldo.length; k += 1) {
      const anterior = p.movimentos[indicesDeSaldo[k - 1]!]!;
      const seguinte = p.movimentos[indicesDeSaldo[k]!]!;
      if (seguinte.data <= anterior.data) continue;

      const estimado = projetarCaixinha({
        movimentos: p.movimentos.slice(0, indicesDeSaldo[k]!),
        percentualCdiBp: p.percentualCdiBp,
        cdi: p.cdi,
        ate: seguinte.data,
        iof: [],
        ir: [],
        convencao,
      }).saldoBrutoCentavos;

      comparacoes.push({
        de: anterior.data,
        ate: seguinte.data,
        informadoCentavos: seguinte.valorCentavos,
        estimadoCentavos: estimado,
        diferencaCentavos: seguinte.valorCentavos - estimado,
      });
    }

    return {
      convencao,
      comparacoes,
      erroAbsolutoTotalCentavos: comparacoes.reduce((s, c) => s + Math.abs(c.diferencaCentavos), 0),
    };
  });

  const comDados = porConvencao.every((c) => c.comparacoes.length > 0);
  const melhor = [...porConvencao].sort(
    (a, b) => a.erroAbsolutoTotalCentavos - b.erroAbsolutoTotalCentavos,
  );
  const empate = melhor[0]!.erroAbsolutoTotalCentavos === melhor[1]!.erroAbsolutoTotalCentavos;

  return {
    porConvencao,
    // empate = os saldos não distinguem as convenções (ex.: nenhum aporte/resgate no meio)
    convencaoSugerida: comDados && !empate ? melhor[0]!.convencao : null,
  };
}
