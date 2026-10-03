import type { SyncResponse, SyncStatusResponse } from '@solidus/shared';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type EnvironmentVariables } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { CategorizacaoService } from '../categorizacao/categorizacao.service';
import { mapearConta, mapearTransacao, type TransacaoMapeada } from '../../domain/sync/mapear';
import { SYNC_JANELA_SOBREPOSICAO_DIAS } from './sync.constants';
import { PluggyGateway } from './pluggy.gateway';
import { PluggyNaoConfiguradoError, SyncEmAndamentoError } from './sync-errors';

const DIA_MS = 24 * 60 * 60 * 1000;
const LOTE = 500;

interface Contadores {
  contas: number;
  transacoesNovas: number;
  transacoesAtualizadas: number;
  semConversao: number;
}

interface TransacaoGravada {
  data: Date;
  descricao: string;
  valorCentavos: number;
  status: string;
  categoriaPluggy: string | null;
}

function dataIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  /** Trava em memória: suficiente para uma instância (spec 02, suposições). */
  private emAndamento = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PluggyGateway,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly categorizacao: CategorizacaoService,
  ) {}

  async sincronizar(): Promise<SyncResponse> {
    const itemId = this.config.get('PLUGGY_ITEM_ID', { infer: true });
    if (!itemId) {
      throw new PluggyNaoConfiguradoError();
    }
    if (this.emAndamento) {
      throw new SyncEmAndamentoError();
    }

    this.emAndamento = true;
    const iniciadoEm = new Date();
    const contadores: Contadores = {
      contas: 0,
      transacoesNovas: 0,
      transacoesAtualizadas: 0,
      semConversao: 0,
    };

    try {
      await this.executar(itemId, contadores);
      await this.categorizarSemDerrubar();
      await this.registrar(iniciadoEm, 'SUCESSO', contadores);
      return { ...contadores, duracaoMs: Date.now() - iniciadoEm.getTime() };
    } catch (error) {
      await this.registrar(iniciadoEm, 'FALHA', contadores, this.codeDoErro(error)).catch(() =>
        this.logger.error('Falha ao registrar o SyncRun'),
      );
      throw error;
    } finally {
      this.emAndamento = false;
    }
  }

  /** Os dados do Pluggy já estão gravados: falhar ao categorizar não pode derrubar o sync (spec 03). */
  private async categorizarSemDerrubar(): Promise<void> {
    try {
      await this.categorizacao.categorizarPendentes();
    } catch (error) {
      this.logger.error(`Falha ao categorizar (${error instanceof Error ? error.name : 'erro'})`);
    }
  }

  async status(): Promise<SyncStatusResponse> {
    const run = await this.prisma.syncRun.findFirst({ orderBy: { iniciadoEm: 'desc' } });
    if (!run) {
      return { ultimoSync: null };
    }
    return {
      ultimoSync: {
        iniciadoEm: run.iniciadoEm.toISOString(),
        finalizadoEm: run.finalizadoEm?.toISOString() ?? null,
        status: run.status,
        contas: run.contas,
        transacoesNovas: run.transacoesNovas,
        transacoesAtualizadas: run.transacoesAtualizadas,
      },
    };
  }

  private async executar(itemId: string, contadores: Contadores): Promise<void> {
    const dateFrom = await this.inicioDaJanela();
    const contasPluggy = await this.gateway.listarContas(itemId);

    for (const contaPluggy of contasPluggy) {
      const mapeada = mapearConta(contaPluggy);
      if (!mapeada) {
        continue;
      }
      const conta = await this.prisma.conta.upsert({
        where: { pluggyAccountId: mapeada.pluggyAccountId },
        create: mapeada,
        update: {
          tipo: mapeada.tipo,
          nome: mapeada.nome,
          saldoCentavos: mapeada.saldoCentavos,
          moeda: mapeada.moeda,
        },
      });
      contadores.contas += 1;

      const transacoes = (await this.gateway.listarTransacoes(contaPluggy.id, dateFrom)).map(
        mapearTransacao,
      );
      contadores.semConversao += transacoes.filter((t) => t.semConversao).length;
      await this.gravarTransacoes(conta.id, transacoes, contadores);
    }
  }

  /** `undefined` no primeiro sync (busca tudo); depois, a data mais recente menos a sobreposição. */
  private async inicioDaJanela(): Promise<string | undefined> {
    const { _max } = await this.prisma.transacao.aggregate({ _max: { data: true } });
    if (!_max.data) {
      return undefined;
    }
    return dataIso(new Date(_max.data.getTime() - SYNC_JANELA_SOBREPOSICAO_DIAS * DIA_MS));
  }

  private async gravarTransacoes(
    contaId: string,
    transacoes: TransacaoMapeada[],
    contadores: Contadores,
  ): Promise<void> {
    for (let i = 0; i < transacoes.length; i += LOTE) {
      const lote = transacoes.slice(i, i + LOTE);
      const existentes = await this.prisma.transacao.findMany({
        where: { pluggyTransactionId: { in: lote.map((t) => t.pluggyTransactionId) } },
      });
      const porId = new Map(existentes.map((e) => [e.pluggyTransactionId, e]));

      const novas = lote.filter((t) => !porId.has(t.pluggyTransactionId));
      if (novas.length > 0) {
        await this.prisma.transacao.createMany({
          data: novas.map((t) => this.paraBanco(contaId, t)),
          skipDuplicates: true,
        });
        contadores.transacoesNovas += novas.length;
      }

      for (const t of lote) {
        const atual = porId.get(t.pluggyTransactionId);
        if (!atual || !this.mudou(atual, t)) {
          continue;
        }
        const { pluggyTransactionId, ...campos } = this.paraBanco(contaId, t);
        await this.prisma.transacao.update({ where: { pluggyTransactionId }, data: campos });
        contadores.transacoesAtualizadas += 1;
      }
    }
  }

  private mudou(atual: TransacaoGravada, novo: TransacaoMapeada): boolean {
    return (
      atual.valorCentavos !== novo.valorCentavos ||
      atual.status !== novo.status ||
      atual.descricao !== novo.descricao ||
      atual.categoriaPluggy !== novo.categoriaPluggy ||
      atual.data.getTime() !== novo.data.getTime()
    );
  }

  private paraBanco(contaId: string, t: TransacaoMapeada) {
    return {
      pluggyTransactionId: t.pluggyTransactionId,
      contaId,
      data: t.data,
      descricao: t.descricao,
      valorCentavos: t.valorCentavos,
      tipo: t.tipo,
      status: t.status,
      moeda: t.moeda,
      categoriaPluggy: t.categoriaPluggy,
    };
  }

  private codeDoErro(error: unknown): string {
    if (error instanceof HttpException) {
      const corpo = error.getResponse();
      if (typeof corpo === 'object' && corpo !== null && 'code' in corpo) {
        return String((corpo as { code: unknown }).code).slice(0, 60);
      }
    }
    return 'ERRO_INTERNO';
  }

  private registrar(
    iniciadoEm: Date,
    status: 'SUCESSO' | 'FALHA',
    contadores: Contadores,
    erro?: string,
  ): Promise<unknown> {
    return this.prisma.syncRun.create({
      data: {
        iniciadoEm,
        finalizadoEm: new Date(),
        status,
        contas: contadores.contas,
        transacoesNovas: contadores.transacoesNovas,
        transacoesAtualizadas: contadores.transacoesAtualizadas,
        erro: erro ?? null,
      },
    });
  }
}
