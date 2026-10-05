import type {
  Caixinha,
  CriarMovimentoRequest,
  MovimentoCaixinha,
  SugestaoMovimento,
} from '@solidus/shared';
import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { hojeUtc } from '../../common/relogio';
import { PrismaService } from '../../database/prisma.service';
import { dataIsoDe, diasEntre, ehDataIso } from '../../domain/carteira/datas';
import {
  CaixinhaNaoEncontradaError,
  dadoInvalido,
  MovimentoNaoEncontradoError,
  TransacaoInvalidaError,
  TransacaoJaVinculadaError,
} from './carteira-errors';
import { AtualizarCaixinhaDto, CriarCaixinhaDto } from './dto/carteira.dto';

const LIMITE_SUGESTOES = 500;

function paraDate(data: string): Date {
  return new Date(`${data}T00:00:00.000Z`);
}

@Injectable()
export class CaixinhasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(userId: string): Promise<Caixinha[]> {
    const caixinhas = await this.prisma.caixinha.findMany({
      where: { userId },
      orderBy: { criadoEm: 'asc' },
    });
    return caixinhas.map((c) => this.paraCaixinha(c));
  }

  async criar(userId: string, dto: CriarCaixinhaDto): Promise<Caixinha> {
    const criada = await this.prisma.caixinha.create({
      data: {
        userId,
        nome: dto.nome,
        percentualCdiBp: dto.percentualCdiBp,
        reservaDeGastos: dto.reservaDeGastos ?? false,
        convencaoRendimento: dto.convencaoRendimento ?? null,
      },
    });
    return this.paraCaixinha(criada);
  }

  async atualizar(userId: string, id: string, dto: AtualizarCaixinhaDto): Promise<Caixinha> {
    await this.exigirCaixinha(userId, id);
    const atualizada = await this.prisma.caixinha.update({
      where: { id, userId },
      data: {
        ...(dto.nome !== undefined && { nome: dto.nome }),
        ...(dto.percentualCdiBp !== undefined && { percentualCdiBp: dto.percentualCdiBp }),
        ...(dto.reservaDeGastos !== undefined && { reservaDeGastos: dto.reservaDeGastos }),
        ...(dto.convencaoRendimento !== undefined && {
          convencaoRendimento: dto.convencaoRendimento,
        }),
        ...(dto.ativa !== undefined && { ativa: dto.ativa }),
      },
    });
    return this.paraCaixinha(atualizada);
  }

  /** Apaga a Caixinha e (em cascata) os movimentos dela. */
  async remover(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.caixinha.deleteMany({ where: { id, userId } });
    if (count === 0) {
      throw new CaixinhaNaoEncontradaError();
    }
  }

  async listarMovimentos(userId: string, caixinhaId: string): Promise<MovimentoCaixinha[]> {
    await this.exigirCaixinha(userId, caixinhaId);
    const movimentos = await this.prisma.movimentoCaixinha.findMany({
      where: { caixinhaId, userId },
      orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }],
    });
    return movimentos.map((m) => this.paraMovimento(m));
  }

  async criarMovimento(
    userId: string,
    caixinhaId: string,
    dto: CriarMovimentoRequest,
  ): Promise<MovimentoCaixinha> {
    await this.exigirCaixinha(userId, caixinhaId);
    this.validarDatas(dto);

    let valor = dto.valorCentavos;
    if (dto.transacaoId !== undefined) {
      valor = await this.validarVinculo(userId, dto, valor);
    }
    if (valor === undefined) {
      throw dadoInvalido('VALOR_OBRIGATORIO', 'valorCentavos é obrigatório sem transacaoId.');
    }
    if (dto.tipo !== 'SALDO' && valor <= 0) {
      throw dadoInvalido('VALOR_INVALIDO', 'APORTE e RESGATE exigem valorCentavos maior que zero.');
    }

    const criado = await this.prisma.movimentoCaixinha.create({
      data: {
        userId,
        caixinhaId,
        tipo: dto.tipo,
        data: paraDate(dto.data),
        valorCentavos: valor,
        dataOrigem: dto.dataOrigem ? paraDate(dto.dataOrigem) : null,
        transacaoId: dto.transacaoId ?? null,
      },
    });
    return this.paraMovimento(criado);
  }

  async removerMovimento(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.movimentoCaixinha.deleteMany({ where: { id, userId } });
    if (count === 0) {
      throw new MovimentoNaoEncontradoError();
    }
  }

  /**
   * Aplicações/resgates do sync ainda sem Caixinha. O Pluggy não diz de qual Caixinha é (a descrição
   * não traz o nome), então não dá para atribuir sozinho: o sistema sugere, o usuário escolhe.
   */
  async sugestoes(userId: string, desde: string): Promise<SugestaoMovimento[]> {
    if (!ehDataIso(desde)) {
      throw dadoInvalido('DATA_INVALIDA', 'desde deve ser uma data YYYY-MM-DD válida.');
    }
    const transacoes = await this.prisma.transacao.findMany({
      where: {
        userId,
        categoria: 'INVESTIMENTO',
        data: { gte: paraDate(desde) },
        movimentoCaixinha: null,
      },
      orderBy: { data: 'desc' },
      take: LIMITE_SUGESTOES,
    });
    return transacoes.map((t) => ({
      transacaoId: t.id,
      data: dataIsoDe(t.data),
      descricao: t.descricao,
      valorCentavos: Math.abs(t.valorCentavos),
      tipo: t.tipo,
      sugestao: t.tipo === 'DEBITO' ? 'APORTE' : 'RESGATE',
    }));
  }

  private validarDatas(dto: CriarMovimentoRequest): void {
    if (!ehDataIso(dto.data)) {
      throw dadoInvalido('DATA_INVALIDA', 'data deve ser uma data YYYY-MM-DD válida.');
    }
    if (diasEntre(hojeUtc(), dto.data) > 0) {
      throw dadoInvalido('DATA_FUTURA', 'data não pode estar no futuro.');
    }
    if (dto.dataOrigem !== undefined) {
      if (dto.tipo !== 'SALDO') {
        throw dadoInvalido('DATA_ORIGEM_INVALIDA', 'dataOrigem só vale para SALDO.');
      }
      if (!ehDataIso(dto.dataOrigem) || diasEntre(dto.dataOrigem, dto.data) < 0) {
        throw dadoInvalido(
          'DATA_ORIGEM_INVALIDA',
          'dataOrigem deve ser uma data válida até a data do saldo.',
        );
      }
    }
  }

  /** Confere a transação vinculada e devolve o valor a usar (o informado, ou o módulo dela). */
  private async validarVinculo(
    userId: string,
    dto: CriarMovimentoRequest,
    valorInformado: number | undefined,
  ): Promise<number> {
    // Só a transação do PRÓPRIO usuário: o id de outra pessoa é tratado como inexistente.
    const transacao = await this.prisma.transacao.findFirst({
      where: { id: dto.transacaoId, userId },
      include: { movimentoCaixinha: { select: { id: true } } },
    });
    if (!transacao || transacao.categoria !== 'INVESTIMENTO') {
      throw new TransacaoInvalidaError('A transação não existe ou não é uma aplicação/resgate.');
    }
    if (dto.tipo === 'SALDO') {
      throw new TransacaoInvalidaError('SALDO não se vincula a uma transação.');
    }
    const esperado = dto.tipo === 'APORTE' ? 'DEBITO' : 'CREDITO';
    if (transacao.tipo !== esperado) {
      throw new TransacaoInvalidaError(
        `${dto.tipo} corresponde a uma transação de ${esperado === 'DEBITO' ? 'saída' : 'entrada'}.`,
      );
    }
    if (transacao.movimentoCaixinha) {
      throw new TransacaoJaVinculadaError();
    }
    return valorInformado ?? Math.abs(transacao.valorCentavos);
  }

  private async exigirCaixinha(userId: string, id: string): Promise<void> {
    const existe = await this.prisma.caixinha.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existe) {
      throw new CaixinhaNaoEncontradaError();
    }
  }

  private paraCaixinha(c: Prisma.CaixinhaGetPayload<object>): Caixinha {
    return {
      id: c.id,
      nome: c.nome,
      percentualCdiBp: c.percentualCdiBp,
      reservaDeGastos: c.reservaDeGastos,
      convencaoRendimento: c.convencaoRendimento,
      ativa: c.ativa,
    };
  }

  private paraMovimento(m: Prisma.MovimentoCaixinhaGetPayload<object>): MovimentoCaixinha {
    return {
      id: m.id,
      caixinhaId: m.caixinhaId,
      tipo: m.tipo,
      data: dataIsoDe(m.data),
      valorCentavos: m.valorCentavos,
      dataOrigem: m.dataOrigem ? dataIsoDe(m.dataOrigem) : null,
      transacaoId: m.transacaoId,
    };
  }
}
