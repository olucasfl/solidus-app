export const MESES_PARA_SER_RECORRENTE = 3;

export interface CreditoDeContraparte {
  chave: string;
  data: Date;
}

export interface RecorrenteDetectado {
  chave: string;
  /** Primeiro recebimento dessa origem: a fonte automática vale desde ele. */
  desde: Date;
}

function mes(data: Date): string {
  return data.toISOString().slice(0, 7);
}

/**
 * Origens que pagaram em `minMeses` ou mais MESES distintos (UTC): vários Pix no mesmo mês contam
 * como um mês só, senão um amigo que devolveu três vezes em março viraria "renda". Quem chama
 * passa só créditos de pessoas (nunca fatura, aplicação ou transferência da própria conta).
 */
export function detectarRecorrentes(
  creditos: readonly CreditoDeContraparte[],
  minMeses: number = MESES_PARA_SER_RECORRENTE,
): RecorrenteDetectado[] {
  const porChave = new Map<string, { meses: Set<string>; desde: Date }>();
  for (const c of creditos) {
    const atual = porChave.get(c.chave) ?? { meses: new Set<string>(), desde: c.data };
    atual.meses.add(mes(c.data));
    if (c.data < atual.desde) atual.desde = c.data;
    porChave.set(c.chave, atual);
  }
  return [...porChave.entries()]
    .filter(([, v]) => v.meses.size >= minMeses)
    .map(([chave, v]) => ({ chave, desde: v.desde }))
    .sort((a, b) => a.desde.getTime() - b.desde.getTime() || a.chave.localeCompare(b.chave));
}
