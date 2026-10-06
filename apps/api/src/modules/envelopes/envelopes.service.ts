import type { Envelope, EnvelopesResponse } from '@solidus/shared';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { calcularEnvelopes, progressoDoEnvelope } from '../../domain/envelopes/calcular-envelopes';
import { CarteiraService } from '../carteira/carteira.service';
import { ReservaService } from '../reserva/reserva.service';
import { AtualizarEnvelopeDto, CriarEnvelopeDto } from './dto/envelopes.dto';
import { EnvelopeJaExisteError, EnvelopeNaoEncontradoError } from './envelopes-errors';

/** Violação do `@@unique([userId, nome])`. */
function nomeDuplicado(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Envelopes virtuais (spec envelopes). Um envelope é só uma anotação do usuário sobre como repartir o que tem:
 * NADA aqui move dinheiro (RULES §1). Todo método recebe o `userId` da SESSÃO e filtra por ele; envelope de outro
 * usuário é "não encontrado" (404).
 */
@Injectable()
export class EnvelopesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carteira: CarteiraService,
    private readonly reserva: ReservaService,
  ) {}

  async obter(userId: string): Promise<EnvelopesResponse> {
    const carteira = await this.carteira.consultar(userId);
    // A meta da reserva vem da spec da reserva (0 quando não há gasto para calcular).
    const { metaCentavos: reservaMetaCentavos } = await this.reserva.obter(userId);
    const [contas, envelopes] = await Promise.all([
      this.prisma.conta.findMany({
        where: { userId },
        select: { tipo: true, saldoCentavos: true },
      }),
      this.prisma.envelope.findMany({
        where: { userId },
        orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const r = calcularEnvelopes({
      caixinhas: carteira.caixinhas.map((c) => ({
        ativa: c.ativa,
        reservaEmergencia: c.reservaEmergencia,
        saldoLiquidoCentavos: c.saldoLiquidoEstimadoCentavos,
        saldoBrutoCentavos: c.saldoBrutoEstimadoCentavos,
        avisos: c.avisos,
      })),
      contas,
      reservaMetaCentavos,
      envelopes: envelopes.map((e) => ({
        id: e.id,
        nome: e.nome,
        alocadoCentavos: e.alocadoCentavos,
        metaCentavos: e.metaCentavos,
      })),
    });

    return {
      disponivel: {
        caixinhasCentavos: r.caixinhasCentavos,
        contaCorrenteCentavos: r.contaCorrenteCentavos,
        totalCentavos: r.totalCentavos,
      },
      reserva: {
        valorCentavos: r.reservaValorCentavos,
        metaCentavos: reservaMetaCentavos,
        excedenteCentavos: r.reservaExcedenteCentavos,
      },
      envelopes: r.envelopes,
      totalAlocadoCentavos: r.totalAlocadoCentavos,
      livreCentavos: r.livreCentavos,
      avisos: r.avisos,
      data: carteira.data,
    };
  }

  /** Criar nunca é bloqueado por falta de dinheiro: o app só avisa (ALOCADO_ACIMA_DO_DISPONIVEL). */
  async criar(userId: string, dto: CriarEnvelopeDto): Promise<Envelope> {
    try {
      const criado = await this.prisma.envelope.create({
        data: {
          userId,
          nome: dto.nome,
          alocadoCentavos: dto.alocadoCentavos ?? 0,
          metaCentavos: dto.metaCentavos ?? null,
        },
      });
      return this.paraEnvelope(criado);
    } catch (error) {
      if (nomeDuplicado(error)) throw new EnvelopeJaExisteError();
      throw error;
    }
  }

  /** Parcial: `undefined` mantém; `metaCentavos: null` remove a meta. */
  async atualizar(userId: string, id: string, dto: AtualizarEnvelopeDto): Promise<Envelope> {
    const existe = await this.prisma.envelope.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existe) {
      throw new EnvelopeNaoEncontradoError();
    }
    try {
      const atualizado = await this.prisma.envelope.update({
        where: { id, userId },
        data: {
          ...(dto.nome !== undefined && { nome: dto.nome }),
          ...(dto.alocadoCentavos !== undefined && { alocadoCentavos: dto.alocadoCentavos }),
          ...(dto.metaCentavos !== undefined && { metaCentavos: dto.metaCentavos }),
        },
      });
      return this.paraEnvelope(atualizado);
    } catch (error) {
      if (nomeDuplicado(error)) throw new EnvelopeJaExisteError();
      throw error;
    }
  }

  /** O valor alocado volta para o "livre" (é só uma anotação: nada se move). */
  async remover(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.envelope.deleteMany({ where: { id, userId } });
    if (count === 0) {
      throw new EnvelopeNaoEncontradoError();
    }
  }

  private paraEnvelope(e: Prisma.EnvelopeGetPayload<object>): Envelope {
    return progressoDoEnvelope({
      id: e.id,
      nome: e.nome,
      alocadoCentavos: e.alocadoCentavos,
      metaCentavos: e.metaCentavos,
    });
  }
}
