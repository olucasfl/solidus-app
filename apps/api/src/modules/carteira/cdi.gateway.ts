import { Injectable, Logger } from '@nestjs/common';
import { dataIsoDoBcb, dataParaBcb, taxaE8DoBcb } from '../../domain/carteira/bcb';
import { type DataIso } from '../../domain/carteira/datas';
import { CdiIndisponivelError } from './carteira-errors';

export interface CdiDiaBcb {
  data: DataIso;
  /** Fração diária x10^8 (0,055131% a.d. => 55131). */
  taxaE8: number;
}

/**
 * Porta de entrada ÚNICA para o CDI. Classe abstrata como token de DI, para os testes trocarem por um
 * mock (nenhum teste chama o Banco Central de verdade).
 */
export abstract class CdiGateway {
  abstract buscar(inicio: DataIso, fim: DataIso): Promise<CdiDiaBcb[]>;
}

const URL_BASE = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados';
const TIMEOUT_MS = 15_000;

interface ItemBcb {
  data: string;
  valor: string;
}

function ehItemBcb(item: unknown): item is ItemBcb {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as ItemBcb).data === 'string' &&
    typeof (item as ItemBcb).valor === 'string'
  );
}

/** Série 12 do SGS/BCB: CDI diário, "% ao dia". Formato documentado; ainda não visto ao vivo (spec 05). */
@Injectable()
export class BcbCdiGateway extends CdiGateway {
  private readonly logger = new Logger(BcbCdiGateway.name);

  async buscar(inicio: DataIso, fim: DataIso): Promise<CdiDiaBcb[]> {
    const url = `${URL_BASE}?formato=json&dataInicial=${encodeURIComponent(dataParaBcb(inicio))}&dataFinal=${encodeURIComponent(dataParaBcb(fim))}`;

    try {
      const resposta = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resposta.ok) {
        throw new Error(`status ${resposta.status}`);
      }
      const corpo: unknown = await resposta.json();
      if (!Array.isArray(corpo) || !corpo.every(ehItemBcb)) {
        throw new TypeError('resposta fora do formato esperado');
      }
      return corpo.map((item) => ({
        data: dataIsoDoBcb(item.data),
        taxaE8: taxaE8DoBcb(item.valor),
      }));
    } catch (error) {
      // Só o nome do erro vai ao log: nunca a resposta nem a URL.
      this.logger.warn(
        `Falha ao consultar o CDI (${error instanceof Error ? error.name : 'erro'})`,
      );
      throw new CdiIndisponivelError();
    }
  }
}
