import type { CategoriaId, HistoricoPoupancaResponse, PoupancaMes } from '@solidus/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { calcularPoupanca, type GrupoMovimento } from '../../domain/poupanca/calcular';

const MESES_PADRAO = 6;

function formatarMes(ano: number, mesZeroBase: number): string {
  const d = new Date(Date.UTC(ano, mesZeroBase, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class PoupancaService {
  constructor(private readonly prisma: PrismaService) {}

  /** `mes` já validado como `YYYY-MM` (DTO). Calendário em UTC, igual a `GET /transacoes?mes=`. */
  async mes(mes: string): Promise<PoupancaMes> {
    const [ano, numero] = mes.split('-').map(Number) as [number, number];
    const grupos = await this.prisma.transacao.groupBy({
      by: ['categoria', 'tipo'],
      where: {
        data: {
          gte: new Date(Date.UTC(ano, numero - 1, 1)),
          lt: new Date(Date.UTC(ano, numero, 1)),
        },
      },
      _count: { _all: true },
      _sum: { valorCentavos: true },
    });

    const movimentos: GrupoMovimento[] = grupos.map((g) => ({
      categoria: g.categoria as CategoriaId | null,
      tipo: g.tipo,
      quantidade: g._count._all,
      totalCentavos: g._sum.valorCentavos ?? 0,
    }));
    return calcularPoupanca(mes, movimentos);
  }

  /** Do mês mais antigo ao corrente, cada um pelo mesmo cálculo de `mes()`. */
  async historico(meses = MESES_PADRAO, hoje = new Date()): Promise<HistoricoPoupancaResponse> {
    const resultado: PoupancaMes[] = [];
    for (let atras = meses - 1; atras >= 0; atras -= 1) {
      resultado.push(
        await this.mes(formatarMes(hoje.getUTCFullYear(), hoje.getUTCMonth() - atras)),
      );
    }
    return { meses: resultado };
  }
}
