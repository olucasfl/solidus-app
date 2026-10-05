import { type DataIso, diasEntre, somarDias } from './datas';

export type TipoMovimento = 'SALDO' | 'APORTE' | 'RESGATE';

export interface Movimento {
  tipo: TipoMovimento;
  data: DataIso;
  valorCentavos: number;
  /** Só SALDO: desde quando o dinheiro já estava aplicado (define a idade para o IR). */
  dataOrigem?: DataIso | null;
}

/** `ateDias: null` = sem limite (só a última faixa). Alíquota em pontos-base (2250 = 22,5%). */
export interface FaixaImposto {
  ateDias: number | null;
  aliquotaBp: number;
}

export type AvisoProjecao =
  'SEM_SALDO_INFORMADO' | 'CDI_DEFASADO' | 'IMPOSTO_NAO_CONFIGURADO' | 'RESGATE_ACIMA_DO_SALDO';

export interface ParametrosProjecao {
  /** Ordenados por data e, no mesmo dia, pela ordem em que foram registrados. */
  movimentos: readonly Movimento[];
  percentualCdiBp: number;
  /** CDI diário por data, inteiro x10^8 (0,055131% a.d. => 55131). Só dias com CDI publicado. */
  cdi: ReadonlyMap<DataIso, number>;
  /** Calcula até esta data (inclusive). */
  ate: DataIso;
  iof: readonly FaixaImposto[];
  ir: readonly FaixaImposto[];
}

export interface ResultadoProjecao {
  saldoInformado: { data: DataIso; centavos: number } | null;
  saldoBrutoCentavos: number;
  rendimentoBrutoCentavos: number;
  impostos: { iofCentavos: number; irCentavos: number } | null;
  saldoLiquidoCentavos: number | null;
  rendimentoLiquidoCentavos: number | null;
  avisos: AvisoProjecao[];
}

/** Saldo interno = centavos x 10^12 (BigInt): nada é arredondado dia a dia, só na saída. */
const ESCALA = 10n ** 12n;
const BP = 10_000n;
/** Mais que isso sem CDI novo (fim de semana + feriado) é dado atrasado, não calendário. */
const TOLERANCIA_CDI_DIAS = 4;

interface Lote {
  principal: bigint;
  saldo: bigint;
  origem: DataIso;
}

function paraCentavos(escalado: bigint): number {
  // Só valores >= 0 chegam aqui; a divisão de BigInt trunca (não arredonda).
  return Number(escalado / ESCALA);
}

function aliquotaDaIdade(faixas: readonly FaixaImposto[], idadeDias: number): bigint {
  const ordenadas = [...faixas].sort(
    (a, b) => (a.ateDias ?? Number.POSITIVE_INFINITY) - (b.ateDias ?? Number.POSITIVE_INFINITY),
  );
  const faixa = ordenadas.find((f) => f.ateDias === null || idadeDias <= f.ateDias);
  return BigInt(faixa?.aliquotaBp ?? 0);
}

function consumirFifo(lotes: Lote[], valor: bigint): boolean {
  let restante = valor;
  while (restante > 0n && lotes.length > 0) {
    const lote = lotes[0]!;
    if (lote.saldo <= restante) {
      restante -= lote.saldo;
      lotes.shift();
    } else {
      const novoSaldo = lote.saldo - restante;
      lote.principal = (lote.principal * novoSaldo) / lote.saldo;
      lote.saldo = novoSaldo;
      restante = 0n;
    }
  }
  return restante > 0n;
}

function ultimaDataDeCdi(cdi: ReadonlyMap<DataIso, number>): DataIso | null {
  let ultima: DataIso | null = null;
  for (const data of cdi.keys()) {
    if (ultima === null || data > ultima) ultima = data;
  }
  return ultima;
}

/**
 * Saldo de uma Caixinha em `ate`, a partir do último SALDO informado. Convenções (spec 05):
 * - o SALDO de um dia vale no FIM daquele dia (movimentos do mesmo dia já estão nele);
 * - o rendimento do dia `d` incide sobre o saldo do começo de `d`, e aporte/resgate de `d` é aplicado
 *   depois — aporte de hoje começa a render amanhã;
 * - só rende dia com CDI publicado; resgate consome os lotes mais antigos primeiro (FIFO);
 * - o líquido (IOF sobre o rendimento, IR sobre rendimento − IOF) é por lote, pela idade do lote.
 */
export function projetarCaixinha(p: ParametrosProjecao): ResultadoProjecao {
  const ancora = [...p.movimentos].filter((m) => m.tipo === 'SALDO' && m.data <= p.ate).pop();
  if (!ancora) {
    return {
      saldoInformado: null,
      saldoBrutoCentavos: 0,
      rendimentoBrutoCentavos: 0,
      impostos: null,
      saldoLiquidoCentavos: null,
      rendimentoLiquidoCentavos: null,
      avisos: ['SEM_SALDO_INFORMADO'],
    };
  }

  const avisos = new Set<AvisoProjecao>();
  const inicial = BigInt(ancora.valorCentavos) * ESCALA;
  const lotes: Lote[] = [
    { principal: inicial, saldo: inicial, origem: ancora.dataOrigem ?? ancora.data },
  ];
  const depois = p.movimentos.filter(
    (m) => m.tipo !== 'SALDO' && m.data > ancora.data && m.data <= p.ate,
  );
  const fatorNumerador = (taxaE8: number): bigint =>
    ESCALA + BigInt(taxaE8) * BigInt(p.percentualCdiBp);

  const dias = diasEntre(ancora.data, p.ate);
  for (let i = 1; i <= dias; i += 1) {
    const dia = somarDias(ancora.data, i);

    const taxa = p.cdi.get(dia);
    if (taxa !== undefined) {
      const f = fatorNumerador(taxa);
      for (const lote of lotes) lote.saldo = (lote.saldo * f) / ESCALA;
    }

    for (const mov of depois.filter((m) => m.data === dia)) {
      const valor = BigInt(mov.valorCentavos) * ESCALA;
      if (mov.tipo === 'APORTE') {
        lotes.push({ principal: valor, saldo: valor, origem: dia });
      } else if (consumirFifo(lotes, valor)) {
        avisos.add('RESGATE_ACIMA_DO_SALDO');
      }
    }
  }

  const ultimoCdi = ultimaDataDeCdi(p.cdi);
  if (dias > 0 && (ultimoCdi === null || diasEntre(ultimoCdi, p.ate) > TOLERANCIA_CDI_DIAS)) {
    avisos.add('CDI_DEFASADO');
  }

  const saldo = lotes.reduce((s, l) => s + l.saldo, 0n);
  const principal = lotes.reduce((s, l) => s + l.principal, 0n);
  const rendimentoBruto = saldo - principal;

  let impostos: ResultadoProjecao['impostos'] = null;
  let saldoLiquido: number | null = null;
  let rendimentoLiquido: number | null = null;

  if (p.iof.length === 0 || p.ir.length === 0) {
    avisos.add('IMPOSTO_NAO_CONFIGURADO');
  } else {
    let iofTotal = 0n;
    let irTotal = 0n;
    for (const lote of lotes) {
      const rendimento = lote.saldo - lote.principal;
      const idade = Math.max(1, diasEntre(lote.origem, p.ate));
      const iof = (rendimento * aliquotaDaIdade(p.iof, idade)) / BP;
      const ir = ((rendimento - iof) * aliquotaDaIdade(p.ir, idade)) / BP;
      iofTotal += iof;
      irTotal += ir;
    }
    impostos = { iofCentavos: paraCentavos(iofTotal), irCentavos: paraCentavos(irTotal) };
    saldoLiquido = paraCentavos(saldo - iofTotal - irTotal);
    rendimentoLiquido = paraCentavos(rendimentoBruto - iofTotal - irTotal);
  }

  return {
    saldoInformado: { data: ancora.data, centavos: ancora.valorCentavos },
    saldoBrutoCentavos: paraCentavos(saldo),
    rendimentoBrutoCentavos: paraCentavos(rendimentoBruto),
    impostos,
    saldoLiquidoCentavos: saldoLiquido,
    rendimentoLiquidoCentavos: rendimentoLiquido,
    avisos: [...avisos],
  };
}
