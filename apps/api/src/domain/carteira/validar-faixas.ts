import { type FaixaImposto } from './projetar';

/**
 * Valida uma tabela de imposto antes de ela substituir a anterior (`PUT /impostos/:tipo`). Devolve a
 * lista de problemas, vazia se estiver ok. Regras: `ateDias` inteiro ≥ 1, estritamente crescente;
 * só a última faixa pode ser `null` (sem limite) e no máximo uma; alíquota inteira de 0 a 10000.
 * Tabela vazia é válida (limpa a configuração: o líquido passa a vir `null` com aviso).
 */
export function validarFaixas(faixas: readonly FaixaImposto[]): string[] {
  const problemas: string[] = [];
  let anterior = 0;

  faixas.forEach((f, i) => {
    const ultima = i === faixas.length - 1;
    if (!Number.isInteger(f.aliquotaBp) || f.aliquotaBp < 0 || f.aliquotaBp > 10_000) {
      problemas.push(`faixa ${i + 1}: aliquotaBp deve ser inteiro de 0 a 10000`);
    }
    if (f.ateDias === null) {
      if (!ultima) problemas.push(`faixa ${i + 1}: só a última faixa pode ter ateDias nulo`);
      return;
    }
    if (!Number.isInteger(f.ateDias) || f.ateDias < 1) {
      problemas.push(`faixa ${i + 1}: ateDias deve ser inteiro ≥ 1`);
      return;
    }
    if (f.ateDias <= anterior) {
      problemas.push(`faixa ${i + 1}: ateDias deve ser maior que o da faixa anterior`);
    }
    anterior = f.ateDias;
  });

  return problemas;
}
