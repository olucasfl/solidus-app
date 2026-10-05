import { type DataIso, dataIsoDe } from '../domain/carteira/datas';

/** "Hoje" como data de calendário em UTC (o mesmo critério dos meses de `/transacoes` e `/poupanca`).
 * Fica numa função para os testes fixarem a data com `jest.spyOn`. */
export function hojeUtc(): DataIso {
  return dataIsoDe(new Date());
}
