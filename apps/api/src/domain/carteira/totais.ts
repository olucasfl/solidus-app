export interface CaixinhaParaTotal {
  ativa: boolean;
  /** Dinheiro reservado para gastar no mês: conta no patrimônio, mas não é "investido". */
  reservaDeGastos: boolean;
  saldoBrutoCentavos: number;
}

export interface TotaisCarteira {
  patrimonioCentavos: number;
  investidoCentavos: number;
  disponivelParaGastarCentavos: number;
}

/** Só Caixinhas ativas entram. patrimônio = investido + disponível para gastar. */
export function totaisDaCarteira(caixinhas: readonly CaixinhaParaTotal[]): TotaisCarteira {
  let investido = 0;
  let disponivel = 0;
  for (const c of caixinhas) {
    if (!c.ativa) continue;
    if (c.reservaDeGastos) disponivel += c.saldoBrutoCentavos;
    else investido += c.saldoBrutoCentavos;
  }
  return {
    patrimonioCentavos: investido + disponivel,
    investidoCentavos: investido,
    disponivelParaGastarCentavos: disponivel,
  };
}
