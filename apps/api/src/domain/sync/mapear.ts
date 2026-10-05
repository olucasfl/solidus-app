import { mapearContraparte, type ParticipantePluggy } from '../contraparte/documento';
import { reaisParaCentavos } from '../money/centavos';

/** Formas mínimas do que o Pluggy devolve — o domínio não importa o SDK. */
export interface ContaPluggy {
  id: string;
  type: string;
  subtype: string;
  name: string;
  balance: number;
  currencyCode: string;
}

export interface TransacaoPluggy {
  id: string;
  date: Date | string;
  description: string;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  amountInAccountCurrency: number | null;
  currencyCode: string;
  category: string | null;
  status?: string;
  /** Só o que o Solidus usa (spec 07): quem pagou e quem recebeu. */
  paymentData?: { payer?: ParticipantePluggy | null; receiver?: ParticipantePluggy | null } | null;
}

export type TipoConta = 'CORRENTE' | 'POUPANCA' | 'CARTAO';

export interface ContaMapeada {
  pluggyAccountId: string;
  tipo: TipoConta;
  nome: string;
  saldoCentavos: number;
  moeda: string;
}

export interface TransacaoMapeada {
  pluggyTransactionId: string;
  data: Date;
  descricao: string;
  valorCentavos: number;
  tipo: 'DEBITO' | 'CREDITO';
  status: 'PENDENTE' | 'EFETIVADA';
  moeda: string;
  categoriaPluggy: string | null;
  /** Spec 07. Chave = HMAC do documento (nunca o documento); nulos sem documento válido. */
  contraparteChave: string | null;
  contraparteNome: string | null;
  contraparteDocMascarado: string | null;
  /** true quando a moeda não é BRL e o Pluggy não informou o valor convertido. */
  semConversao: boolean;
}

const MOEDA_BASE = 'BRL';

/** Conta de tipo desconhecido devolve `null` (é ignorada pelo sync). */
export function mapearConta(conta: ContaPluggy): ContaMapeada | null {
  const tipo = tipoDaConta(conta);
  if (!tipo) {
    return null;
  }
  return {
    pluggyAccountId: conta.id,
    tipo,
    nome: conta.name.slice(0, 120),
    saldoCentavos: reaisParaCentavos(conta.balance),
    moeda: conta.currencyCode,
  };
}

function tipoDaConta(conta: ContaPluggy): TipoConta | null {
  if (conta.type === 'CREDIT' && conta.subtype === 'CREDIT_CARD') return 'CARTAO';
  if (conta.type === 'BANK' && conta.subtype === 'CHECKING_ACCOUNT') return 'CORRENTE';
  if (conta.type === 'BANK' && conta.subtype === 'SAVINGS_ACCOUNT') return 'POUPANCA';
  return null;
}

/**
 * O sinal vem do `type`, nunca do valor cru: na conta corrente o Pluggy manda DEBIT negativo, mas no
 * cartão manda a compra (DEBIT) positiva e o pagamento (CREDIT) negativo. DEBIT é sempre saída
 * (negativo) e CREDIT sempre entrada (positivo), em módulo.
 */
export function mapearTransacao(t: TransacaoPluggy, segredoContraparte?: string): TransacaoMapeada {
  const estrangeira = t.currencyCode !== MOEDA_BASE;
  const semConversao = estrangeira && t.amountInAccountCurrency == null;
  const reais = estrangeira && !semConversao ? t.amountInAccountCurrency! : t.amount;
  const modulo = Math.abs(reaisParaCentavos(reais));
  const descricao = t.description.slice(0, 500);

  // Entrada → quem pagou; saída → quem recebeu. Sem segredo configurado não há contraparte.
  const contraparte = segredoContraparte
    ? mapearContraparte(
        t.type === 'CREDIT' ? t.paymentData?.payer : t.paymentData?.receiver,
        descricao,
        segredoContraparte,
      )
    : null;

  return {
    pluggyTransactionId: t.id,
    data: new Date(t.date),
    descricao,
    contraparteChave: contraparte?.chave ?? null,
    contraparteNome: contraparte?.nome ?? null,
    contraparteDocMascarado: contraparte?.docMascarado ?? null,
    valorCentavos: t.type === 'DEBIT' ? -modulo : modulo,
    tipo: t.type === 'DEBIT' ? 'DEBITO' : 'CREDITO',
    status: t.status === 'PENDING' ? 'PENDENTE' : 'EFETIVADA',
    moeda: t.currencyCode,
    categoriaPluggy: t.category ? t.category.slice(0, 120) : null,
    semConversao,
  };
}
