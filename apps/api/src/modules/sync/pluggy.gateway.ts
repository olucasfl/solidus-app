import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PluggyClient } from 'pluggy-sdk';
import { type ContaPluggy, type TransacaoPluggy } from '../../domain/sync/mapear';
import { type EnvironmentVariables } from '../../config/env.validation';
import { PluggyIndisponivelError } from './sync-errors';

/**
 * Porta de entrada ÚNICA para o Pluggy: só métodos de leitura (RULES §1 — o app nunca escreve em
 * conta real). Classe abstrata como token de DI, para os testes trocarem por um mock.
 */
export abstract class PluggyGateway {
  abstract listarContas(itemId: string): Promise<ContaPluggy[]>;
  abstract listarTransacoes(contaId: string, dateFrom?: string): Promise<TransacaoPluggy[]>;
}

@Injectable()
export class PluggySdkGateway extends PluggyGateway {
  private readonly logger = new Logger(PluggySdkGateway.name);
  private client?: PluggyClient;

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    super();
  }

  async listarContas(itemId: string): Promise<ContaPluggy[]> {
    return this.executar(async () => (await this.sdk().fetchAccounts(itemId)).results);
  }

  async listarTransacoes(contaId: string, dateFrom?: string): Promise<TransacaoPluggy[]> {
    return this.executar(() =>
      this.sdk().fetchAllTransactions(contaId, dateFrom ? { dateFrom } : undefined),
    );
  }

  private sdk(): PluggyClient {
    this.client ??= new PluggyClient({
      clientId: this.config.get('PLUGGY_CLIENT_ID', { infer: true }),
      clientSecret: this.config.get('PLUGGY_CLIENT_SECRET', { infer: true }),
    });
    return this.client;
  }

  /** Qualquer falha vira PluggyIndisponivelError; só o nome do erro vai ao log, nunca o corpo. */
  private async executar<T>(chamada: () => Promise<T>): Promise<T> {
    try {
      return await chamada();
    } catch (error) {
      this.logger.warn(
        `Falha ao consultar o Pluggy (${error instanceof Error ? error.name : 'erro'})`,
      );
      throw new PluggyIndisponivelError();
    }
  }
}
