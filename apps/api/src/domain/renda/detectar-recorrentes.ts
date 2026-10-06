/**
 * Quando uma origem de Pix de pessoa vira "renda recorrente" (spec 07). Três condições, todas:
 *  1. pagou em `MESES_PARA_SER_RECORRENTE` ou mais MESES distintos (UTC);
 *  2. em média no máximo `MAX_PAGAMENTOS_POR_MES` pagamentos por mês em que pagou;
 *  3. valor médio por pagamento de pelo menos `VALOR_MEDIO_MINIMO_CENTAVOS`.
 *
 * Só "3 meses" não separava renda de rateio: no dado real, quem divide conta do dia a dia paga todo
 * mês, mas com muitos pagamentos pequenos (uma origem somava 55 pagamentos de ≈ R$ 85 em 13 meses).
 * Renda de verdade tem poucos pagamentos e de valor relevante. O limite de valor é uma escolha (R$ 300):
 * renda menor que isso não é reconhecida sozinha, mas o usuário ainda pode marcá-la à mão.
 */
export const MESES_PARA_SER_RECORRENTE = 3;
export const MAX_PAGAMENTOS_POR_MES = 2;
export const VALOR_MEDIO_MINIMO_CENTAVOS = 30_000;

export interface CreditoDeContraparte {
  chave: string;
  data: Date;
  /** Módulo do valor, em centavos inteiros. */
  valorCentavos: number;
}

export interface RecorrenteDetectado {
  chave: string;
  /** Primeiro recebimento dessa origem: a fonte automática vale desde ele. */
  desde: Date;
}

export interface CriteriosRecorrencia {
  minMeses: number;
  maxPagamentosPorMes: number;
  valorMedioMinimoCentavos: number;
}

export const CRITERIOS_PADRAO: CriteriosRecorrencia = {
  minMeses: MESES_PARA_SER_RECORRENTE,
  maxPagamentosPorMes: MAX_PAGAMENTOS_POR_MES,
  valorMedioMinimoCentavos: VALOR_MEDIO_MINIMO_CENTAVOS,
};

function mes(data: Date): string {
  return data.toISOString().slice(0, 7);
}

/**
 * Vários Pix no mesmo mês contam como um mês só (um amigo que devolveu três vezes em março não vira
 * "renda"). Quem chama passa só créditos de pessoas (nunca fatura, aplicação ou conta própria).
 * As comparações são todas em inteiros (`pagamentos ≤ máx × meses`, `soma ≥ mínimo × pagamentos`):
 * nada de divisão nem ponto flutuante em dinheiro.
 */
export function detectarRecorrentes(
  creditos: readonly CreditoDeContraparte[],
  criterios: CriteriosRecorrencia = CRITERIOS_PADRAO,
): RecorrenteDetectado[] {
  const porChave = new Map<
    string,
    { meses: Set<string>; desde: Date; pagamentos: number; somaCentavos: number }
  >();
  for (const c of creditos) {
    const atual = porChave.get(c.chave) ?? {
      meses: new Set<string>(),
      desde: c.data,
      pagamentos: 0,
      somaCentavos: 0,
    };
    atual.meses.add(mes(c.data));
    if (c.data < atual.desde) atual.desde = c.data;
    atual.pagamentos += 1;
    atual.somaCentavos += c.valorCentavos;
    porChave.set(c.chave, atual);
  }

  return [...porChave.entries()]
    .filter(
      ([, v]) =>
        v.meses.size >= criterios.minMeses &&
        v.pagamentos <= criterios.maxPagamentosPorMes * v.meses.size &&
        v.somaCentavos >= criterios.valorMedioMinimoCentavos * v.pagamentos,
    )
    .map(([chave, v]) => ({ chave, desde: v.desde }))
    .sort((a, b) => a.desde.getTime() - b.desde.getTime() || a.chave.localeCompare(b.chave));
}
