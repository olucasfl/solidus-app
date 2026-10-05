import type { CategoriaId, RecalcularResponse, RegraCategoria } from '@solidus/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrigemCategoria, type Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { categorizar, type RegraUsuario } from '../../domain/categorizacao/categorizar';
import { AtualizarRegraDto } from './dto/atualizar-regra.dto';
import { CriarRegraDto } from './dto/criar-regra.dto';

interface LinhaParaCategorizar {
  id: string;
  descricao: string;
  tipo: 'DEBITO' | 'CREDITO';
  categoriaPluggy: string | null;
  valorCentavos: number;
  categoria: string | null;
  origemCategoria: OrigemCategoria | null;
}

const SELECT_LINHA = {
  id: true,
  descricao: true,
  tipo: true,
  categoriaPluggy: true,
  valorCentavos: true,
  categoria: true,
  origemCategoria: true,
} as const;

@Injectable()
export class CategorizacaoService {
  constructor(private readonly prisma: PrismaService) {}

  async listarRegras(): Promise<RegraCategoria[]> {
    const regras = await this.prisma.regraCategoria.findMany({
      orderBy: [{ prioridade: 'desc' }, { criadoEm: 'asc' }],
    });
    return regras.map((r) => this.paraRegra(r));
  }

  async criarRegra(dto: CriarRegraDto): Promise<RegraCategoria> {
    if (
      dto.valorMinCentavos !== undefined &&
      dto.valorMaxCentavos !== undefined &&
      dto.valorMinCentavos > dto.valorMaxCentavos
    ) {
      throw this.faixaInvalida();
    }
    const regra = await this.prisma.regraCategoria.create({
      data: {
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
  async atualizarRegra(id: string, dto: AtualizarRegraDto): Promise<RegraCategoria> {
    const atual = await this.prisma.regraCategoria.findUnique({ where: { id } });
    if (!atual) {
      throw this.regraNaoEncontrada();
    }
    const min = dto.valorMinCentavos === undefined ? atual.valorMinCentavos : dto.valorMinCentavos;
    const max = dto.valorMaxCentavos === undefined ? atual.valorMaxCentavos : dto.valorMaxCentavos;
    if (min !== null && max !== null && min > max) {
      throw this.faixaInvalida();
    }

    const regra = await this.prisma.regraCategoria.update({
      where: { id },
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

  async removerRegra(id: string): Promise<void> {
    const { count } = await this.prisma.regraCategoria.deleteMany({ where: { id } });
    if (count === 0) {
      throw this.regraNaoEncontrada();
    }
  }

  /** Só o que ainda não tem categoria (transações novas do sync). Devolve quantas receberam. */
  async categorizarPendentes(): Promise<number> {
    const linhas = await this.prisma.transacao.findMany({
      where: { categoria: null },
      select: SELECT_LINHA,
    });
    return this.aplicar(linhas);
  }

  /** Reaplica as regras em tudo que não é MANUAL (a manual nunca é tocada por regra). */
  async recalcular(): Promise<RecalcularResponse> {
    const linhas = await this.prisma.transacao.findMany({
      where: { OR: [{ origemCategoria: null }, { origemCategoria: { not: 'MANUAL' } }] },
      select: SELECT_LINHA,
    });
    return { analisadas: linhas.length, alteradas: await this.aplicar(linhas) };
  }

  /** Reavalia uma transação por regra (usado ao soltar uma categoria manual). */
  async categorizarUma(
    id: string,
  ): Promise<{ categoria: CategoriaId; origemCategoria: OrigemCategoria }> {
    const regras = await this.carregarRegras();
    const linha = await this.prisma.transacao.findUniqueOrThrow({
      where: { id },
      select: SELECT_LINHA,
    });
    const { categoria, origem } = categorizar(linha, regras);
    await this.prisma.transacao.update({
      where: { id },
      data: { categoria, origemCategoria: origem },
    });
    return { categoria, origemCategoria: origem };
  }

  /** Devolve quantas linhas mudaram. Atualiza por grupo (categoria, origem), não linha a linha. */
  private async aplicar(linhas: LinhaParaCategorizar[]): Promise<number> {
    if (linhas.length === 0) {
      return 0;
    }
    const regras = await this.carregarRegras();
    const grupos = new Map<
      string,
      { categoria: CategoriaId; origem: OrigemCategoria; ids: string[] }
    >();

    for (const linha of linhas) {
      const { categoria, origem } = categorizar(linha, regras);
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
        where: { id: { in: ids } },
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

  private async carregarRegras(): Promise<RegraUsuario[]> {
    const regras = await this.prisma.regraCategoria.findMany();
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
