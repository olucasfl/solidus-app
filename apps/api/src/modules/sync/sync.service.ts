import type { SyncResponse, SyncStatusResponse } from '@solidus/shared';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type EnvironmentVariables } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { CategorizacaoService } from '../categorizacao/categorizacao.service';
import { RendaService } from '../renda/renda.service';
import { mapearConta, mapearTransacao, type TransacaoMapeada } from '../../domain/sync/mapear';
import { SYNC_JANELA_SOBREPOSICAO_DIAS } from './sync.constants';
import { PluggyGateway } from './pluggy.gateway';
import {
  PluggyNaoConfiguradoError,
  SyncDonoNaoEncontradoError,
  SyncEmAndamentoError,
} from './sync-errors';

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
  contraparteChave?: string | null;
  contraparteNome?: string | null;
  contraparteDocMascarado?: string | null;
}

/** `completo` ignora a janela recente e busca TODO o histórico (backfill da contraparte, spec 07). */
export interface OpcoesSync {
  completo?: boolean;
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
    private readonly renda: RendaService,
  ) {}

  async sincronizar(opcoes: OpcoesSync = {}): Promise<SyncResponse> {
    const itemId = this.config.get('PLUGGY_ITEM_ID', { infer: true });
    if (!itemId) {
      throw new PluggyNaoConfiguradoError();
    }
    if (this.emAndamento) {
      throw new SyncEmAndamentoError();
    }
    this.emAndamento = true;
    try {
      return await this.sincronizarDoDono(itemId, await this.resolverDono(), opcoes);
    } finally {
      this.emAndamento = false;
    }
  }

  private async sincronizarDoDono(
    itemId: string,
    donoId: string,
    opcoes: OpcoesSync,
  ): Promise<SyncResponse> {
    const iniciadoEm = new Date();
    const contadores: Contadores = {
      contas: 0,
      transacoesNovas: 0,
      transacoesAtualizadas: 0,
      semConversao: 0,
    };

    try {
      await this.executar(donoId, itemId, contadores, opcoes.completo === true);
      await this.categorizarSemDerrubar(donoId, opcoes.completo === true);
      await this.registrar(donoId, iniciadoEm, 'SUCESSO', contadores);
      return { ...contadores, duracaoMs: Date.now() - iniciadoEm.getTime() };
    } catch (error) {
      await this.registrar(donoId, iniciadoEm, 'FALHA', contadores, this.codeDoErro(error)).catch(
        () => this.logger.error('Falha ao registrar o SyncRun'),
      );
      throw error;
    }
  }

  /**
   * Os dados do Pluggy já estão gravados: falhar ao categorizar não pode derrubar o sync (spec 03).
   * Fonte de renda nova (reconhecida agora) ou histórico reprocessado muda a categoria de transações
   * JÁ categorizadas, então nesses casos reaplica tudo (`recalcular`); senão, só as pendentes.
   */
  private async categorizarSemDerrubar(donoId: string, completo: boolean): Promise<void> {
    try {
      const novasFontes = await this.renda.reconhecerRecorrentes(donoId);
      if (completo || novasFontes > 0) {
        await this.categorizacao.recalcular(donoId);
      } else {
        await this.categorizacao.categorizarPendentes(donoId);
      }
    } catch (error) {
      this.logger.error(`Falha ao categorizar (${error instanceof Error ? error.name : 'erro'})`);
    }
  }

  /**
   * TRANSITÓRIO (spec 06, até a etapa 3 trazer `Conexao` por usuário): a credencial do Pluggy vem do
   * `.env` e é de UMA pessoa — o usuário cujo e-mail é `SEED_USER_EMAIL`. Os dados sincronizados são
   * gravados no nome dele, nunca de "quem chamou" (o cron não tem sessão).
   */
  private async resolverDono(): Promise<string> {
    const email = this.config.get('SEED_USER_EMAIL', { infer: true });
    const dono = email
      ? await this.prisma.user.findUnique({ where: { email }, select: { id: true } })
      : null;
    if (!dono) {
      throw new SyncDonoNaoEncontradoError();
    }
    return dono.id;
  }

  async status(userId: string): Promise<SyncStatusResponse> {
    const run = await this.prisma.syncRun.findFirst({
      where: { userId },
      orderBy: { iniciadoEm: 'desc' },
    });
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

  private async executar(
    donoId: string,
    itemId: string,
    contadores: Contadores,
    completo: boolean,
  ): Promise<void> {
    const dateFrom = completo ? undefined : await this.inicioDaJanela(donoId);
    const segredo = this.config.get('CONTRAPARTE_HMAC_SECRET', { infer: true });
    const contasPluggy = await this.gateway.listarContas(itemId);

    for (const contaPluggy of contasPluggy) {
      const mapeada = mapearConta(contaPluggy);
      if (!mapeada) {
        continue;
      }
      const existente = await this.prisma.conta.findUnique({
        where: { pluggyAccountId: mapeada.pluggyAccountId },
        select: { userId: true },
      });
      if (existente && existente.userId !== donoId) {
        // Nunca sobrescreve a conta de outra pessoa (o id do Pluggy é único no mundo).
        throw new Error('Conta do Pluggy pertence a outro usuário');
      }
      const conta = await this.prisma.conta.upsert({
        where: { pluggyAccountId: mapeada.pluggyAccountId },
        create: { ...mapeada, userId: donoId },
        update: {
          tipo: mapeada.tipo,
          nome: mapeada.nome,
          saldoCentavos: mapeada.saldoCentavos,
          moeda: mapeada.moeda,
        },
      });
      contadores.contas += 1;

      const transacoes = (await this.gateway.listarTransacoes(contaPluggy.id, dateFrom)).map((t) =>
        mapearTransacao(t, segredo),
      );
      contadores.semConversao += transacoes.filter((t) => t.semConversao).length;
      await this.gravarTransacoes(donoId, conta.id, transacoes, contadores);
    }
  }

  /** `undefined` no primeiro sync (busca tudo); depois, a data mais recente menos a sobreposição. */
  private async inicioDaJanela(donoId: string): Promise<string | undefined> {
    const { _max } = await this.prisma.transacao.aggregate({
      where: { userId: donoId },
      _max: { data: true },
    });
    if (!_max.data) {
      return undefined;
    }
    return dataIso(new Date(_max.data.getTime() - SYNC_JANELA_SOBREPOSICAO_DIAS * DIA_MS));
  }

  private async gravarTransacoes(
    donoId: string,
    contaId: string,
    transacoes: TransacaoMapeada[],
    contadores: Contadores,
  ): Promise<void> {
    for (let i = 0; i < transacoes.length; i += LOTE) {
      const lote = transacoes.slice(i, i + LOTE);
      const existentes = await this.prisma.transacao.findMany({
        where: {
          userId: donoId,
          pluggyTransactionId: { in: lote.map((t) => t.pluggyTransactionId) },
        },
      });
      const porId = new Map(existentes.map((e) => [e.pluggyTransactionId, e]));

      const novas = lote.filter((t) => !porId.has(t.pluggyTransactionId));
      if (novas.length > 0) {
        await this.prisma.transacao.createMany({
          data: novas.map((t) => this.paraBanco(donoId, contaId, t)),
          skipDuplicates: true,
        });
        contadores.transacoesNovas += novas.length;
      }

      for (const t of lote) {
        const atual = porId.get(t.pluggyTransactionId);
        if (!atual || !this.mudou(atual, t)) {
          continue;
        }
        const {
          pluggyTransactionId,
          userId: _dono,
          ...campos
        } = this.paraBanco(donoId, contaId, t);
        await this.prisma.transacao.update({
          where: { pluggyTransactionId, userId: donoId },
          data: campos,
        });
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
      (atual.contraparteChave ?? null) !== novo.contraparteChave ||
      (atual.contraparteNome ?? null) !== novo.contraparteNome ||
      (atual.contraparteDocMascarado ?? null) !== novo.contraparteDocMascarado ||
      atual.data.getTime() !== novo.data.getTime()
    );
  }

  private paraBanco(donoId: string, contaId: string, t: TransacaoMapeada) {
    return {
      userId: donoId,
      pluggyTransactionId: t.pluggyTransactionId,
      contaId,
      data: t.data,
      descricao: t.descricao,
      valorCentavos: t.valorCentavos,
      tipo: t.tipo,
      status: t.status,
      moeda: t.moeda,
      categoriaPluggy: t.categoriaPluggy,
      contraparteChave: t.contraparteChave,
      contraparteNome: t.contraparteNome,
      contraparteDocMascarado: t.contraparteDocMascarado,
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
    donoId: string,
    iniciadoEm: Date,
    status: 'SUCESSO' | 'FALHA',
    contadores: Contadores,
    erro?: string,
  ): Promise<unknown> {
    return this.prisma.syncRun.create({
      data: {
        userId: donoId,
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
