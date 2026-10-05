/**
 * Taxonomia fechada de categorias (spec 03-categorizacao). A `natureza` é o que a taxa de poupança
 * (spec 04) usa: só RECEITA e DESPESA entram na conta; NEUTRA (fatura, aporte, transferência
 * própria) fica de fora; INDEFINIDA é reportada, nunca chutada.
 */
export const CATEGORIAS = [
  { id: 'MORADIA', nome: 'Moradia', natureza: 'DESPESA' },
  { id: 'MERCADO', nome: 'Mercado', natureza: 'DESPESA' },
  { id: 'RESTAURANTES_DELIVERY', nome: 'Restaurantes e delivery', natureza: 'DESPESA' },
  { id: 'TRANSPORTE', nome: 'Transporte', natureza: 'DESPESA' },
  { id: 'SAUDE', nome: 'Saúde', natureza: 'DESPESA' },
  { id: 'LAZER', nome: 'Lazer', natureza: 'DESPESA' },
  { id: 'EDUCACAO', nome: 'Educação e livros', natureza: 'DESPESA' },
  { id: 'ASSINATURAS_COMUNICACAO', nome: 'Assinaturas e comunicação', natureza: 'DESPESA' },
  { id: 'COMPRAS', nome: 'Compras', natureza: 'DESPESA' },
  { id: 'VIAGENS', nome: 'Viagens', natureza: 'DESPESA' },
  { id: 'DOACOES', nome: 'Doações', natureza: 'DESPESA' },
  { id: 'IMPOSTOS_TARIFAS', nome: 'Impostos e tarifas', natureza: 'DESPESA' },
  { id: 'SERVICOS', nome: 'Serviços', natureza: 'DESPESA' },
  { id: 'OUTRAS_DESPESAS', nome: 'Outras despesas', natureza: 'DESPESA' },
  { id: 'SALARIO', nome: 'Salário', natureza: 'RECEITA' },
  { id: 'RENDIMENTOS_CASHBACK', nome: 'Rendimentos e cashback', natureza: 'RECEITA' },
  { id: 'OUTRAS_RECEITAS', nome: 'Outras receitas', natureza: 'RECEITA' },
  { id: 'INVESTIMENTO', nome: 'Aplicações e resgates', natureza: 'NEUTRA' },
  { id: 'PAGAMENTO_FATURA', nome: 'Pagamento de fatura', natureza: 'NEUTRA' },
  { id: 'TRANSFERENCIA_INTERNA', nome: 'Entre contas próprias', natureza: 'NEUTRA' },
  { id: 'PIX_RECEBIDO_DE_PESSOAS', nome: 'Pix recebido de pessoas', natureza: 'NEUTRA' },
  { id: 'PIX_ENVIADO_PARA_PESSOAS', nome: 'Pix enviado para pessoas', natureza: 'NEUTRA' },
  { id: 'A_CLASSIFICAR', nome: 'A classificar', natureza: 'INDEFINIDA' },
] as const;

export type Categoria = (typeof CATEGORIAS)[number];
export type CategoriaId = Categoria['id'];
export type NaturezaCategoria = Categoria['natureza'];

export const CATEGORIA_IDS: readonly CategoriaId[] = CATEGORIAS.map((c) => c.id);

export function ehCategoriaId(valor: unknown): valor is CategoriaId {
  return typeof valor === 'string' && (CATEGORIA_IDS as readonly string[]).includes(valor);
}

/** Id desconhecido (ex.: categoria antiga que saiu da taxonomia) é INDEFINIDA, nunca um erro. */
export function naturezaDe(id: string): NaturezaCategoria {
  return CATEGORIAS.find((c) => c.id === id)?.natureza ?? 'INDEFINIDA';
}
