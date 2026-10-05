import type {
  CategoriaId,
  DefinirCategoriaResponse,
  ListaTransacoesResponse,
  OrigemCategoria,
} from '@solidus/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CategorizacaoService } from '../categorizacao/categorizacao.service';
import { type ListarTransacoesQuery } from './dto/transacoes.dto';

const LIMITE_PADRAO = 50;

@Injectable()
export class TransacoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categorizacao: CategorizacaoService,
  ) {}

  async listar(userId: string, query: ListarTransacoesQuery): Promise<ListaTransacoesResponse> {
    const pagina = query.pagina ?? 1;
    const limite = query.limite ?? LIMITE_PADRAO;
    const where: Prisma.TransacaoWhereInput = { userId };

    if (query.mes) {
      const [ano, mes] = query.mes.split('-').map(Number) as [number, number];
      where.data = {
        gte: new Date(Date.UTC(ano, mes - 1, 1)),
        lt: new Date(Date.UTC(ano, mes, 1)),
      };
    }
    if (query.categoria) {
      where.categoria = query.categoria;
    }

    const [total, linhas] = await Promise.all([
      this.prisma.transacao.count({ where: { ...where, userId } }),
      this.prisma.transacao.findMany({
        where: { ...where, userId },
        orderBy: [{ data: 'desc' }, { id: 'asc' }],
        skip: (pagina - 1) * limite,
        take: limite,
      }),
    ]);

    return {
      total,
      pagina,
      limite,
      itens: linhas.map((t) => ({
        id: t.id,
        contaId: t.contaId,
        data: t.data.toISOString(),
        descricao: t.descricao,
        valorCentavos: t.valorCentavos,
        tipo: t.tipo,
        status: t.status,
        moeda: t.moeda,
        categoria: t.categoria as CategoriaId | null,
        origemCategoria: t.origemCategoria as OrigemCategoria | null,
        // Nome e máscara servem para a pessoa reconhecer a origem; a chave (hash) nunca sai da API.
        contraparte:
          t.contraparteNome || t.contraparteDocMascarado
            ? { nome: t.contraparteNome, docMascarado: t.contraparteDocMascarado }
            : null,
      })),
    };
  }

  async definirCategoria(
    userId: string,
    id: string,
    categoria: CategoriaId | null,
  ): Promise<DefinirCategoriaResponse> {
    const existente = await this.prisma.transacao.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existente) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'TRANSACAO_NAO_ENCONTRADA',
        message: 'Transação não encontrada.',
      });
    }

    if (categoria === null) {
      return { id, ...(await this.categorizacao.categorizarUma(userId, id)) };
    }

    await this.prisma.transacao.update({
      where: { id, userId },
      data: { categoria, origemCategoria: 'MANUAL' },
    });
    return { id, categoria, origemCategoria: 'MANUAL' };
  }
}
