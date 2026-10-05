import { type CategoriaId } from '@solidus/shared';

/**
 * Fonte de renda (spec 07): uma origem (contraparte) que o usuário marcou como salário, ou que o
 * Solidus reconheceu como pagadora recorrente. Vale entre `vigenteDesde` e `vigenteAte` (inclusive,
 * por DIA em UTC); `vigenteAte` nulo = sem fim.
 */
export interface FonteAplicavel {
  tipo: 'SALARIO' | 'RECORRENTE';
  chave: string;
  vigenteDesde: Date;
  vigenteAte: Date | null;
  ativa: boolean;
}

export interface EntradaFonte {
  tipo: 'DEBITO' | 'CREDITO';
  contraparteChave?: string | null;
  data: Date;
}

function dia(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function vigenteNoDia<T extends FonteAplicavel>(fonte: T, data: Date): boolean {
  const d = dia(data);
  return d >= dia(fonte.vigenteDesde) && (fonte.vigenteAte === null || d <= dia(fonte.vigenteAte));
}

/**
 * A fonte que explica esta transação, ou `null`. Só ENTRADA conta como renda, a fonte precisa estar
 * ativa e vigente no dia da transação, e SALARIO vence RECORRENTE quando as duas casam (o usuário
 * promoveu a origem; a decisão manual manda sobre a automática).
 */
export function fonteDaTransacao<T extends FonteAplicavel>(
  entrada: EntradaFonte,
  fontes: readonly T[],
): T | null {
  if (entrada.tipo !== 'CREDITO' || !entrada.contraparteChave) return null;
  const candidatas = fontes.filter(
    (f) => f.ativa && f.chave === entrada.contraparteChave && vigenteNoDia(f, entrada.data),
  );
  return candidatas.find((f) => f.tipo === 'SALARIO') ?? candidatas[0] ?? null;
}

/** Categoria que a fonte dá à entrada: salário é SALARIO; recorrente é OUTRAS_RECEITAS. */
export function categoriaDaFonte(
  entrada: EntradaFonte,
  fontes: readonly FonteAplicavel[],
): CategoriaId | null {
  const fonte = fonteDaTransacao(entrada, fontes);
  if (!fonte) return null;
  return fonte.tipo === 'SALARIO' ? 'SALARIO' : 'OUTRAS_RECEITAS';
}
