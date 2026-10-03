import type { CategoriaId } from './categoria';

/** Contrato de categorização e listagem de transações (spec 03-categorizacao). */
export type OrigemCategoria = 'REGRA_USUARIO' | 'REGRA_PADRAO' | 'MANUAL';
export type TipoTransacao = 'DEBITO' | 'CREDITO';

export interface RegraCategoria {
  id: string;
  padrao: string;
  categoria: CategoriaId;
  tipo: TipoTransacao | null;
  prioridade: number;
}

export interface CriarRegraRequest {
  padrao: string;
  categoria: CategoriaId;
  tipo?: TipoTransacao;
  prioridade?: number;
}

export interface DefinirCategoriaRequest {
  categoria: CategoriaId | null;
}

export interface DefinirCategoriaResponse {
  id: string;
  categoria: CategoriaId | null;
  origemCategoria: OrigemCategoria | null;
}

export interface RecalcularResponse {
  analisadas: number;
  alteradas: number;
}

export interface TransacaoResumo {
  id: string;
  contaId: string;
  data: string;
  descricao: string;
  valorCentavos: number;
  tipo: TipoTransacao;
  status: 'PENDENTE' | 'EFETIVADA';
  moeda: string;
  categoria: CategoriaId | null;
  origemCategoria: OrigemCategoria | null;
}

export interface ListaTransacoesResponse {
  total: number;
  pagina: number;
  limite: number;
  itens: TransacaoResumo[];
}
