import {
  naturezaDe,
  PIX_ENTRE_PESSOAS_LIQUIDO,
  type AvisoPoupanca,
  type CategoriaId,
  type NaturezaCategoria,
  type PoupancaCategoria,
  type PoupancaMes,
} from '@solidus/shared';

/** Soma de um (categoria, tipo) no mês — é o que o `groupBy` do banco devolve. */
export interface GrupoMovimento {
  categoria: CategoriaId | null;
  tipo: 'DEBITO' | 'CREDITO';
  quantidade: number;
  totalCentavos: number;
}

const SEM_CATEGORIA = 'SEM_CATEGORIA';

function naturezaDoGrupo(categoria: CategoriaId | null): NaturezaCategoria {
  return categoria === null ? 'INDEFINIDA' : naturezaDe(categoria);
}

/** Pontos-base inteiros, metade para longe do zero. Só inteiros entram na divisão. */
function taxaEmBasisPoints(poupancaCentavos: number, receitasCentavos: number): number {
  const bp =
    Math.sign(poupancaCentavos) *
    Math.round(Math.abs(poupancaCentavos * 10_000) / receitasCentavos);
  return bp === 0 ? 0 : bp;
}

interface PixPessoas {
  quantidade: number;
  entradasCentavos: number;
  saidasCentavos: number;
}

/**
 * Pix entre pessoas que não são renda (spec 07) contam pelo LÍQUIDO do mês, `saídas − entradas`:
 * saiu mais do que entrou → a diferença é despesa; entrou mais → o excedente abate despesa
 * (reembolso do que você já pagou), até o limite das despesas, e NUNCA vira receita.
 * `somaDespesas` é a soma assinada das categorias de despesa (saída negativa).
 */
function aplicarPixLiquido(
  pix: PixPessoas,
  somaDespesas: number,
): {
  somaDespesas: number;
  liquido: number;
  abatimento: number;
  categoria: PoupancaCategoria | null;
} {
  const liquido = pix.saidasCentavos - pix.entradasCentavos;
  const categoria = (totalCentavos: number): PoupancaCategoria => ({
    categoria: PIX_ENTRE_PESSOAS_LIQUIDO,
    natureza: 'DESPESA',
    // Linha derivada: as transações já foram contadas nas categorias PIX_*; contar de novo quebraria
    // a identidade `soma das quantidades = transacoes`.
    quantidade: 0,
    totalCentavos,
  });

  if (liquido > 0) {
    return {
      somaDespesas: somaDespesas - liquido,
      liquido,
      abatimento: 0,
      categoria: categoria(-liquido),
    };
  }
  if (liquido < 0) {
    const despesaAtual = Math.max(0, -somaDespesas);
    const abatimento = Math.min(-liquido, despesaAtual);
    return {
      somaDespesas: somaDespesas + abatimento,
      liquido,
      abatimento,
      categoria: abatimento > 0 ? categoria(abatimento) : null,
    };
  }
  return { somaDespesas, liquido: 0, abatimento: 0, categoria: null };
}

/**
 * `(receitas − despesas) / receitas` do mês. Só RECEITA e DESPESA entram; NEUTRA (fatura, aporte,
 * transferência própria) fica fora; INDEFINIDA e "sem categoria" são reportadas, nunca chutadas.
 * Estorno (valor positivo numa categoria de despesa) reduz a despesa. Os Pix entre pessoas entram
 * pelo líquido (`aplicarPixLiquido`).
 */
export function calcularPoupanca(mes: string, grupos: readonly GrupoMovimento[]): PoupancaMes {
  let receitas = 0;
  let somaDespesas = 0;
  let transacoes = 0;
  let neutras = 0;
  const indefinidas = { quantidade: 0, entradasCentavos: 0, saidasCentavos: 0 };
  const pixPessoas = { quantidade: 0, entradasCentavos: 0, saidasCentavos: 0 };
  const porCategoria = new Map<string, PoupancaCategoria>();

  for (const g of grupos) {
    const natureza = naturezaDoGrupo(g.categoria);
    transacoes += g.quantidade;

    const chave = g.categoria ?? SEM_CATEGORIA;
    const atual = porCategoria.get(chave) ?? {
      categoria: g.categoria ?? SEM_CATEGORIA,
      natureza,
      quantidade: 0,
      totalCentavos: 0,
    };
    atual.quantidade += g.quantidade;
    atual.totalCentavos += g.totalCentavos;
    porCategoria.set(chave, atual);

    if (natureza === 'RECEITA') {
      receitas += g.totalCentavos;
    } else if (natureza === 'DESPESA') {
      somaDespesas += g.totalCentavos;
    } else if (natureza === 'NEUTRA') {
      neutras += g.quantidade;
      if (g.categoria === 'PIX_RECEBIDO_DE_PESSOAS') {
        pixPessoas.quantidade += g.quantidade;
        pixPessoas.entradasCentavos += g.totalCentavos;
      } else if (g.categoria === 'PIX_ENVIADO_PARA_PESSOAS') {
        pixPessoas.quantidade += g.quantidade;
        pixPessoas.saidasCentavos += -g.totalCentavos;
      }
    } else {
      indefinidas.quantidade += g.quantidade;
      if (g.tipo === 'CREDITO') {
        indefinidas.entradasCentavos += g.totalCentavos;
      } else {
        indefinidas.saidasCentavos += -g.totalCentavos;
      }
    }
  }

  const pix = aplicarPixLiquido(pixPessoas, somaDespesas);
  somaDespesas = pix.somaDespesas;
  if (pix.categoria) porCategoria.set(PIX_ENTRE_PESSOAS_LIQUIDO, pix.categoria);

  const despesas = somaDespesas === 0 ? 0 : -somaDespesas;
  const poupanca = receitas - despesas;
  const temReceita = receitas > 0;

  const avisos: AvisoPoupanca[] = [];
  if (transacoes === 0) avisos.push('SEM_TRANSACOES');
  if (!temReceita) avisos.push('SEM_RECEITA');
  if (indefinidas.entradasCentavos > 0) avisos.push('ENTRADAS_A_CLASSIFICAR');

  return {
    mes,
    receitasCentavos: receitas,
    despesasCentavos: despesas,
    poupancaCentavos: poupanca,
    taxaBasisPoints: temReceita ? taxaEmBasisPoints(poupanca, receitas) : null,
    transacoes,
    neutras: { quantidade: neutras },
    indefinidas,
    pixPessoas: {
      ...pixPessoas,
      liquidoCentavos: pix.liquido,
      abatimentoCentavos: pix.abatimento,
    },
    porCategoria: [...porCategoria.values()].sort(
      (a, b) => Math.abs(b.totalCentavos) - Math.abs(a.totalCentavos),
    ),
    avisos,
  };
}
