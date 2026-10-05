import { type CategoriaId } from '@solidus/shared';
import { normalizar } from './normalizar';

export type TipoTransacao = 'DEBITO' | 'CREDITO';
export type OrigemRegra = 'REGRA_USUARIO' | 'REGRA_PADRAO';

export interface EntradaCategorizacao {
  descricao: string;
  tipo: TipoTransacao;
  categoriaPluggy: string | null;
  /** Assinado, como gravado; a faixa de uma regra compara o MÓDULO. */
  valorCentavos: number;
}

export interface RegraUsuario {
  padrao: string;
  categoria: CategoriaId;
  tipo: TipoTransacao | null;
  /** Faixa opcional sobre o módulo do valor (ex.: salário ≈ R$ 1.044: 80000 a 150000). */
  valorMinCentavos?: number | null;
  valorMaxCentavos?: number | null;
  prioridade: number;
  criadoEm: Date;
}

export interface ResultadoCategorizacao {
  categoria: CategoriaId;
  origem: OrigemRegra;
}

/** Descrição manda sobre a categoria do Pluggy: ela chama o pagamento de fatura de "Transfers". */
const REGRAS_POR_DESCRICAO: ReadonlyArray<{ contem: readonly string[]; categoria: CategoriaId }> = [
  { contem: ['pagamento de fatura', 'pagamento recebido'], categoria: 'PAGAMENTO_FATURA' },
];

const CATEGORIA_PLUGGY: Readonly<Record<string, CategoriaId>> = {
  groceries: 'MERCADO',
  'eating out': 'RESTAURANTES_DELIVERY',
  'food delivery': 'RESTAURANTES_DELIVERY',
  'taxi and ride-hailing': 'TRANSPORTE',
  parking: 'TRANSPORTE',
  'gas stations': 'TRANSPORTE',
  automotive: 'TRANSPORTE',
  pharmacy: 'SAUDE',
  'cinema, theater and concerts': 'LAZER',
  tickets: 'LAZER',
  gambling: 'LAZER',
  bookstore: 'EDUCACAO',
  'office supplies': 'EDUCACAO',
  'digital services': 'ASSINATURAS_COMUNICACAO',
  telecommunications: 'ASSINATURAS_COMUNICACAO',
  shopping: 'COMPRAS',
  'online shopping': 'COMPRAS',
  clothing: 'COMPRAS',
  electronics: 'COMPRAS',
  'sports goods': 'COMPRAS',
  'kids and toys': 'COMPRAS',
  travel: 'VIAGENS',
  donations: 'DOACOES',
  'tax on financial operations': 'IMPOSTOS_TARIFAS',
  services: 'SERVICOS',
};

const DESCRICAO_INVESTIMENTO = ['aplicacao', 'resgate'];

function padraoPorTipo(entrada: EntradaCategorizacao): CategoriaId | null {
  const pluggy = entrada.categoriaPluggy ? normalizar(entrada.categoriaPluggy) : '';

  if (pluggy === 'cashback' && entrada.tipo === 'CREDITO') return 'RENDIMENTOS_CASHBACK';
  if (pluggy === 'transfers' || pluggy === 'third party transfers') {
    return entrada.tipo === 'CREDITO' ? 'A_CLASSIFICAR' : 'TRANSFERENCIAS_ENVIADAS';
  }
  return CATEGORIA_PLUGGY[pluggy] ?? null;
}

function regraPadrao(entrada: EntradaCategorizacao): CategoriaId {
  const descricao = normalizar(entrada.descricao);

  for (const regra of REGRAS_POR_DESCRICAO) {
    if (regra.contem.some((trecho) => descricao.includes(trecho))) {
      return regra.categoria;
    }
  }

  const pluggy = entrada.categoriaPluggy ? normalizar(entrada.categoriaPluggy) : '';
  if (pluggy === 'same person transfer') {
    // Saída para conta própria é neutra. ENTRADA de conta própria é ambígua (pode ser salário que
    // chega por outra conta): fica A_CLASSIFICAR e aparece nos avisos — quem decide é o usuário.
    return entrada.tipo === 'DEBITO' ? 'TRANSFERENCIA_INTERNA' : 'A_CLASSIFICAR';
  }
  if (
    pluggy === 'investments' ||
    pluggy === 'fixed income' ||
    DESCRICAO_INVESTIMENTO.some((trecho) => descricao.includes(trecho))
  ) {
    return 'INVESTIMENTO';
  }

  return (
    padraoPorTipo(entrada) ?? (entrada.tipo === 'DEBITO' ? 'OUTRAS_DESPESAS' : 'A_CLASSIFICAR')
  );
}

function dentroDaFaixa(regra: RegraUsuario, entrada: EntradaCategorizacao): boolean {
  const modulo = Math.abs(entrada.valorCentavos);
  const min = regra.valorMinCentavos ?? null;
  const max = regra.valorMaxCentavos ?? null;
  return (min === null || modulo >= min) && (max === null || modulo <= max);
}

/** Regras do usuário, da mais forte para a mais fraca: prioridade maior; empate, a mais antiga. */
function ordenar(regras: readonly RegraUsuario[]): RegraUsuario[] {
  return [...regras].sort(
    (a, b) => b.prioridade - a.prioridade || a.criadoEm.getTime() - b.criadoEm.getTime(),
  );
}

/**
 * Categoria da transação por regra (a categoria MANUAL é decidida por quem persiste: nunca chega
 * aqui). Casamento por substring normalizada — nunca regex, porque o padrão vem do usuário.
 */
export function categorizar(
  entrada: EntradaCategorizacao,
  regrasUsuario: readonly RegraUsuario[],
): ResultadoCategorizacao {
  const descricao = normalizar(entrada.descricao);

  for (const regra of ordenar(regrasUsuario)) {
    const padrao = normalizar(regra.padrao);
    const tipoCasa = regra.tipo === null || regra.tipo === entrada.tipo;
    if (
      padrao.length > 0 &&
      tipoCasa &&
      dentroDaFaixa(regra, entrada) &&
      descricao.includes(padrao)
    ) {
      return { categoria: regra.categoria, origem: 'REGRA_USUARIO' };
    }
  }

  return { categoria: regraPadrao(entrada), origem: 'REGRA_PADRAO' };
}
