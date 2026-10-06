import type { ConfiguracaoReserva, ReservaEmergenciaResponse } from '@solidus/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  calcularReserva,
  type CaixinhaMarcada,
  type MesDaJanela,
} from '../../domain/reserva/calcular-reserva';
import { CarteiraService } from '../carteira/carteira.service';
import { PoupancaService } from '../poupanca/poupanca.service';
import { AtualizarConfiguracaoReservaDto } from './dto/reserva.dto';

/** Sem registro, valem estes padrões (spec reserva-emergencia, "Suposições"). */
export const CONFIGURACAO_PADRAO: ConfiguracaoReserva = { meses: 6, base: 'BRUTA', janelaMeses: 6 };

/**
 * Reserva de emergência (spec reserva-emergencia). Compõe a poupança (gasto por mês) e a carteira (saldo por
 * Caixinha) e entrega o resultado da regra pura de `domain/reserva`. Todo método recebe o `userId` da SESSÃO.
 */
@Injectable()
export class ReservaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly poupanca: PoupancaService,
    private readonly carteira: CarteiraService,
  ) {}

  async configuracao(userId: string): Promise<ConfiguracaoReserva> {
    const c = await this.prisma.configuracaoReserva.findUnique({ where: { userId } });
    return c ? { meses: c.meses, base: c.base, janelaMeses: c.janelaMeses } : CONFIGURACAO_PADRAO;
  }

  /** Cria o registro na primeira vez; depois só muda o que veio. Corpo sem nenhum campo → 400. */
  async atualizarConfiguracao(
    userId: string,
    dto: AtualizarConfiguracaoReservaDto,
  ): Promise<ConfiguracaoReserva> {
    const mudancas = {
      ...(dto.meses !== undefined && { meses: dto.meses }),
      ...(dto.base !== undefined && { base: dto.base }),
      ...(dto.janelaMeses !== undefined && { janelaMeses: dto.janelaMeses }),
    };
    if (Object.keys(mudancas).length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'CONFIGURACAO_VAZIA',
        message: 'Envie ao menos um campo: meses, base ou janelaMeses.',
      });
    }
    const c = await this.prisma.configuracaoReserva.upsert({
      where: { userId },
      create: { userId, ...mudancas },
      update: mudancas,
    });
    return { meses: c.meses, base: c.base, janelaMeses: c.janelaMeses };
  }

  /** `agora` é injetável para o teste não depender do dia em que roda. */
  async obter(userId: string, agora: Date = new Date()): Promise<ReservaEmergenciaResponse> {
    const configuracao = await this.configuracao(userId);

    // Os últimos meses FECHADOS: pede um a mais e descarta o último (o mês corrente, incompleto).
    const historico = await this.poupanca.historico(userId, configuracao.janelaMeses + 1, agora);
    const mesesDaJanela: MesDaJanela[] = historico.meses.slice(0, -1).map((m) => ({
      mes: m.mes,
      // Bruto = despesa SEM creditar o Pix recebido de pessoas; líquido = a da taxa de poupança.
      brutoCentavos: m.despesasCentavos + m.pixPessoas.abatimentoCentavos,
      liquidoCentavos: m.despesasCentavos,
      transacoes: m.transacoes,
    }));

    const carteira = await this.carteira.consultar(userId);
    const caixinhasMarcadas: CaixinhaMarcada[] = carteira.caixinhas
      .filter((c) => c.reservaEmergencia && c.ativa)
      .map((c) => ({
        id: c.id,
        nome: c.nome,
        saldoLiquidoCentavos: c.saldoLiquidoEstimadoCentavos,
        saldoBrutoCentavos: c.saldoBrutoEstimadoCentavos,
        avisos: c.avisos,
      }));

    const r = calcularReserva({ mesesDaJanela, caixinhasMarcadas, configuracao });
    return {
      configuracao,
      gasto: {
        base: r.baseUsada,
        meses: r.mesesConsiderados,
        mediaMensalBrutaCentavos: r.mediaMensalBrutaCentavos,
        mediaMensalLiquidaCentavos: r.mediaMensalLiquidaCentavos,
        mediaMensalCentavos: r.mediaMensalCentavos,
      },
      metaCentavos: r.metaCentavos,
      reserva: { saldoCentavos: r.saldoCentavos, caixinhas: r.caixinhas },
      faltaCentavos: r.faltaCentavos,
      coberturaMesesCentesimos: r.coberturaMesesCentesimos,
      atingida: r.atingida,
      avisos: r.avisos,
      data: carteira.data,
    };
  }
}
