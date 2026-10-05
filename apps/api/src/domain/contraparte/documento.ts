import { createHmac } from 'node:crypto';

/**
 * Contraparte de uma transação (spec 07): quem pagou (entrada) ou quem recebeu (saída). Este é o
 * ÚNICO arquivo que toca o documento (CPF/CNPJ) em claro. Ele nunca é gravado nem logado: só o HMAC
 * (chave de comparação, inútil sem o segredo) e uma máscara para exibir.
 */

const TAMANHO_CPF = 11;
const TAMANHO_CNPJ = 14;
const NOME_MAX = 200;

function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

function documentoValido(digitos: string): boolean {
  return digitos.length === TAMANHO_CPF || digitos.length === TAMANHO_CNPJ;
}

/** HMAC-SHA256 (hex, 64 chars) dos dígitos do documento; `null` se não for CPF/CNPJ. */
export function hashDocumento(
  documento: string | null | undefined,
  segredo: string,
): string | null {
  if (!documento) return null;
  const digitos = somenteDigitos(documento);
  if (!documentoValido(digitos)) return null;
  return createHmac('sha256', segredo).update(digitos).digest('hex');
}

/**
 * Máscara de exibição, no padrão que o Pix já usa: CPF mostra só o miolo (`***.123.456-**`), CNPJ
 * esconde o fim (`**.123.456/****-**`). Documento inválido não tem máscara.
 */
export function mascararDocumento(documento: string | null | undefined): string | null {
  if (!documento) return null;
  const d = somenteDigitos(documento);
  if (d.length === TAMANHO_CPF) {
    return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  }
  if (d.length === TAMANHO_CNPJ) {
    return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`;
  }
  return null;
}

/**
 * Nome da contraparte: o do Pluggy quando vier; senão, melhor esforço sobre a descrição do Pix
 * (`Transferência Recebida|NOME` / `Transferência enviada pelo Pix|NOME`: o nome é o que vem depois
 * do `|`). Sem nada confiável devolve `null` e a tela mostra a máscara.
 */
export function nomeDaContraparte(
  nomeDoPluggy: string | null | undefined,
  descricao: string,
): string | null {
  const direto = limparNome(nomeDoPluggy);
  if (direto) return direto;
  const barra = descricao.indexOf('|');
  return barra < 0 ? null : limparNome(descricao.slice(barra + 1));
}

// Soft hyphen e espaços de largura zero. Montados por código (não literais) para o arquivo não
// carregar caracteres invisíveis; removidos um a um porque o ZWJ numa classe de regex é enganoso.
const INVISIVEIS = [0x00ad, 0x200b, 0x200c, 0x200d, 0xfeff].map((codigo) =>
  String.fromCharCode(codigo),
);

function limparNome(valor: string | null | undefined): string | null {
  if (!valor) return null;
  // Espaços e hífens "invisíveis" (soft hyphen etc.) aparecem nas descrições reais do Pix.
  const semInvisiveis = INVISIVEIS.reduce((texto, car) => texto.split(car).join(''), valor);
  const nome = semInvisiveis.replace(/\s+/g, ' ').trim();
  return nome.length > 0 ? nome.slice(0, NOME_MAX) : null;
}

/** O que o Pluggy manda em `paymentData.payer` / `paymentData.receiver` (só o que usamos). */
export interface ParticipantePluggy {
  name?: string | null;
  documentNumber?: { value?: string | null } | null;
}

export interface ContraparteMapeada {
  chave: string;
  nome: string | null;
  docMascarado: string | null;
}

/**
 * Quem chama escolhe o participante (entrada → `payer`, saída → `receiver`). Sem documento válido
 * não há contraparte: a chave é o que identifica a origem, e nome sozinho pode ser homônimo.
 */
export function mapearContraparte(
  participante: ParticipantePluggy | null | undefined,
  descricao: string,
  segredo: string,
): ContraparteMapeada | null {
  const documento = participante?.documentNumber?.value;
  const chave = hashDocumento(documento, segredo);
  if (!chave) return null;
  return {
    chave,
    nome: nomeDaContraparte(participante?.name, descricao),
    docMascarado: mascararDocumento(documento),
  };
}
