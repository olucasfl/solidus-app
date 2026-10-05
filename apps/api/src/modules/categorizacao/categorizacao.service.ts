import type { CategoriaId, RecalcularResponse, RegraCategoria } from '@solidus/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrigemCategoria, type Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { categorizar, type RegraUsuario } from '../../domain/categorizacao/categorizar';
import { type FonteAplicavel } from '../../domain/renda/aplicar-fontes';
import { AtualizarRegraDto } from './dto/atualizar-regra.dto';
import { CriarRegraDto } from './dto/criar-regra.dto';

interface LinhaParaCategorizar {
  id: string;
  data: Date;
  contraparteChave: string | null;
  descricao: string;
  tipo: 'DEBITO' | 'CREDITO';
  categoriaPluggy: string | null;
  valorCentavos: number;
  categoria: string | null;
  origemCategoria: OrigemCategoria | null;
}

const SELECT_LINHA = {
  id: true,
  data: true,
  contraparteChave: true,
  descricao: true,
  tipo: true,
  categoriaPluggy: true,
  valorCentavos: true,
  categoria: true,
  origemCategoria: true,
} as const;

/**
 * Multiusuário (spec 06): TODO método recebe o `userId` da SESSÃO e filtra por ele — nunca confia em
 * id vindo do cliente. Recurso de outro usuário é "não encontrado" (404), não "proibido".
 */
@Injectable()
export class CategorizacaoService {
  constructor(private readonly prisma: PrismaService) {}

  async listarRegras(userId: string): Promise<RegraCategoria[]> {
    const regras = await this.prisma.regraCategoria.findMany({
      where: { userId },
      orderBy: [{ prioridade: 'desc' }, { criadoEm: 'asc' }],
    });
    return regras.map((r) => this.paraRegra(r));
  }

  async criarRegra(userId: string, dto: CriarRegraDto): Promise<RegraCategoria> {
    if (
      dto.valorMinCentavos !== undefined &&
      dto.valorMaxCentavos !== undefined &&
      dto.valorMinCentavos > dto.valorMaxCentavos
    ) {
      throw this.faixaInvalida();
    }
    const regra = await this.prisma.regraCategoria.create({
      data: {
        userId,
        padrao: dto.padrao,
        categoria: dto.categoria,
        tipo: dto.tipo ?? null,
        valorMinCentavos: dto.valorMinCentavos ?? null,
        valorMaxCentavos: dto.valorMaxCentavos ?? null,
        prioridade: dto.prioridade ?? 0,
      },
    });
    return this.paraRegra(regra);
  }

  /** Edição parcial: `undefined` mantém, `null` remove a restrição (tipo ou limite da faixa). */
  async atualizarRegra(
    userId: string,
    id: string,
    dto: AtualizarRegraDto,
  ): Promise<RegraCategoria> {
    const atual = await this.prisma.regraCategoria.findFirst({ where: { id, userId } });
    if (!atual) {
      throw this.regraNaoEncontrada();
    }
    const min = dto.valorMinCentavos === undefined ? atual.valorMinCentavos : dto.valorMinCentavos;
    const max = dto.valorMaxCentavos === undefined ? atual.valorMaxCentavos : dto.valorMaxCentavos;
    if (min !== null && max !== null && min > max) {
      throw this.faixaInvalida();
    }

    const regra = await this.prisma.regraCategoria.update({
      where: { id, userId },
      data: {
        ...(dto.padrao !== undefined && { padrao: dto.padrao }),
        ...(dto.categoria !== undefined && { categoria: dto.categoria }),
        ...(dto.tipo !== undefined && { tipo: dto.tipo }),
        ...(dto.prioridade !== undefined && { prioridade: dto.prioridade }),
        valorMinCentavos: min,
        valorMaxCentavos: max,
      },
    });
    return this.paraRegra(regra);
  }

  async removerRegra(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.regraCategoria.deleteMany({ where: { id, userId } });
    if (count === 0) {
      throw this.regraNaoEncontrada();
    }
  }

  /** Só o que ainda não tem categoria (transações novas do sync). Devolve quantas receberam. */
  async categorizarPendentes(userId: string): Promise<number> {
    const linhas = await this.prisma.transacao.findMany({
      where: { userId, categoria: null },
      select: SELECT_LINHA,
    });
    return this.aplicar(userId, linhas);
  }

  /** Reaplica as regras em tudo que não é MANUAL (a manual nunca é tocada por regra). */
  async recalcular(userId: string): Promise<RecalcularResponse> {
    const linhas = await this.prisma.transacao.findMany({
      where: {
        userId,
        OR: [{ origemCategoria: null }, { origemCategoria: { not: 'MANUAL' } }],
      },
      select: SELECT_LINHA,
    });
    return { analisadas: linhas.length, alteradas: await this.aplicar(userId, linhas) };
  }

  /** Reavalia uma transação por regra (usado ao soltar uma categoria manual). */
  async categorizarUma(
    userId: string,
    id: string,
  ): Promise<{ categoria: CategoriaId; origemCategoria: OrigemCategoria }> {
    const [regras, fontes] = await Promise.all([
      this.carregarRegras(userId),
      this.carregarFontes(userId),
    ]);
    const linha = await this.prisma.transacao.findFirstOrThrow({
      where: { id, userId },
      select: SELECT_LINHA,
    });
    const { categoria, origem } = categorizar(linha, regras, fontes);
    await this.prisma.transacao.update({
      where: { id, userId },
      data: { categoria, origemCategoria: origem },
    });
    return { categoria, origemCategoria: origem };
  }

  /** Devolve quantas linhas mudaram. Atualiza por grupo (categoria, origem), não linha a linha. */
  private async aplicar(userId: string, linhas: LinhaParaCategorizar[]): Promise<number> {
    if (linhas.length === 0) {
      return 0;
    }
    const [regras, fontes] = await Promise.all([
      this.carregarRegras(userId),
      this.carregarFontes(userId),
    ]);
    const grupos = new Map<
      string,
      { categoria: CategoriaId; origem: OrigemCategoria; ids: string[] }
    >();

    for (const linha of linhas) {
      const { categoria, origem } = categorizar(linha, regras, fontes);
      if (linha.categoria === categoria && linha.origemCategoria === origem) {
        continue;
      }
      const chave = `${categoria}|${origem}`;
      const grupo = grupos.get(chave) ?? { categoria, origem, ids: [] };
      grupo.ids.push(linha.id);
      grupos.set(chave, grupo);
    }

    let alteradas = 0;
    for (const { categoria, origem, ids } of grupos.values()) {
      await this.prisma.transacao.updateMany({
        where: { id: { in: ids }, userId },
        data: { categoria, origemCategoria: origem },
      });
      alteradas += ids.length;
    }
    return alteradas;
  }

  private faixaInvalida(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      code: 'FAIXA_INVALIDA',
      message: 'valorMinCentavos não pode ser maior que valorMaxCentavos.',
    });
  }

  private regraNaoEncontrada(): NotFoundException {
    return new NotFoundException({
      statusCode: 404,
      code: 'REGRA_NAO_ENCONTRADA',
      message: 'Regra não encontrada.',
    });
  }

  private async carregarRegras(userId: string): Promise<RegraUsuario[]> {
    const regras = await this.prisma.regraCategoria.findMany({ where: { userId } });
    return regras.map((r) => ({
      padrao: r.padrao,
      categoria: r.categoria as CategoriaId,
      tipo: r.tipo,
      valorMinCentavos: r.valorMinCentavos,
      valorMaxCentavos: r.valorMaxCentavos,
      prioridade: r.prioridade,
      criadoEm: r.criadoEm,
    }));
  }

  /** Fontes de renda ativas do usuário (spec 07): entram na categorização entre a regra e o padrão. */
  private async carregarFontes(userId: string): Promise<FonteAplicavel[]> {
    const fontes = await this.prisma.fonteRenda.findMany({ where: { userId, ativa: true } });
    return fontes.map((f) => ({
      tipo: f.tipo,
      chave: f.contraparteChave,
      vigenteDesde: f.vigenteDesde,
      vigenteAte: f.vigenteAte,
      ativa: f.ativa,
    }));
  }

  private paraRegra(r: Prisma.RegraCategoriaGetPayload<object>): RegraCategoria {
    return {
      id: r.id,
      padrao: r.padrao,
      categoria: r.categoria as CategoriaId,
      tipo: r.tipo,
      valorMinCentavos: r.valorMinCentavos,
      valorMaxCentavos: r.valorMaxCentavos,
      prioridade: r.prioridade,
    };
  }
}
