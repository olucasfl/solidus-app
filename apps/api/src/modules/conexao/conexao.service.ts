import type { ConexaoResponse } from '@solidus/shared';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { avaliarConexao } from '../../domain/conexao/avaliar';
import { PluggyGateway } from '../sync/pluggy.gateway';

/** Só o code, nunca a mensagem do Pluggy (spec: nenhum texto livre do Pluggy é gravado). */
const ERRO_PLUGGY_INDISPONIVEL = 'PLUGGY_INDISPONIVEL';

/**
 * Estado da conexão com o Pluggy (spec aviso-conexao-pluggy). Todo método recebe o `userId` da SESSÃO
 * (ou do dono do sync) e filtra por ele. O app só LÊ o item e avisa: reautorizar é com o usuário.
 */
@Injectable()
export class ConexaoService {
  private readonly logger = new Logger(ConexaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PluggyGateway,
  ) {}

  /**
   * Lê o item e grava o retrato. **Nunca lança**: é chamado no começo do sync e uma falha aqui (Pluggy fora do
   * ar, banco) não pode abortar a sincronização. Se a leitura do item falha, o retrato anterior é mantido e só
   * `erroVerificacao` muda; na próxima leitura bem-sucedida ele é limpo.
   */
  async registrar(userId: string, itemId: string): Promise<void> {
    let item;
    try {
      item = await this.gateway.listarItem(itemId);
    } catch (error) {
      this.logger.warn(
        `Não consegui ler o item do Pluggy (${error instanceof Error ? error.name : 'erro'})`,
      );
      await this.marcarErroDeVerificacao(userId, itemId);
      return;
    }

    // Campo a campo, de propósito: uma lista explícita do que pode ser gravado. Nada de `...item`, para que um
    // campo extra (mensagem de erro, statusDetail, conteúdo de userAction) nunca chegue ao banco.
    const dados = {
      itemId,
      statusItem: item.statusItem,
      statusExecucao: item.statusExecucao,
      consentimentoExpiraEm: item.consentimentoExpiraEm,
      ultimaAtualizacaoEm: item.ultimaAtualizacaoEm,
      proximaAtualizacaoEm: item.proximaAtualizacaoEm,
      autoSyncDesativadoEm: item.autoSyncDesativadoEm,
      falhasDeLogin: item.falhasDeLogin,
      acaoPendente: item.acaoPendente,
      verificadoEm: new Date(),
      erroVerificacao: null,
    };
    try {
      await this.prisma.conexaoPluggy.upsert({
        where: { userId },
        create: { userId, ...dados },
        update: dados,
      });
    } catch (error) {
      this.logger.error(
        `Falha ao gravar o retrato da conexão (${error instanceof Error ? error.name : 'erro'})`,
      );
    }
  }

  /** Só `erroVerificacao`: o retrato anterior (status, datas) fica como estava. Também nunca lança. */
  private async marcarErroDeVerificacao(userId: string, itemId: string): Promise<void> {
    try {
      await this.prisma.conexaoPluggy.upsert({
        where: { userId },
        create: { userId, itemId, erroVerificacao: ERRO_PLUGGY_INDISPONIVEL },
        update: { erroVerificacao: ERRO_PLUGGY_INDISPONIVEL },
      });
    } catch {
      this.logger.error('Falha ao registrar o erro de verificação da conexão');
    }
  }

  /** Não chama o Pluggy: lê o retrato que o último sync gravou (o dado é D+1). Nunca devolve o `itemId`. */
  async obter(userId: string, agora: Date = new Date()): Promise<ConexaoResponse> {
    const r = await this.prisma.conexaoPluggy.findUnique({ where: { userId } });
    const { situacao, avisos } = avaliarConexao(r, agora);
    return {
      situacao,
      avisos,
      conexao: r
        ? {
            status: r.statusItem,
            consentimentoExpiraEm: r.consentimentoExpiraEm?.toISOString() ?? null,
            ultimaAtualizacaoEm: r.ultimaAtualizacaoEm?.toISOString() ?? null,
            verificadoEm: r.verificadoEm?.toISOString() ?? null,
          }
        : null,
      calculadoEm: agora.toISOString(),
    };
  }
}
