import type { CdiSyncResponse } from '@solidus/shared';
import { Injectable } from '@nestjs/common';
import { hojeUtc } from '../../common/relogio';
import { PrismaService } from '../../database/prisma.service';
import { type DataIso, dataIsoDe, somarDias } from '../../domain/carteira/datas';
import { CdiGateway } from './cdi.gateway';

const JANELA_RELEITURA_DIAS = 7;
const JANELA_SEM_DADOS_DIAS = 30;

function paraDate(data: DataIso): Date {
  return new Date(`${data}T00:00:00.000Z`);
}

@Injectable()
export class CdiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CdiGateway,
  ) {}

  /** Idempotente: dia já gravado nunca é duplicado nem alterado. */
  async sincronizar(): Promise<CdiSyncResponse> {
    const hoje = hojeUtc();
    const inicio = await this.inicioDaBusca(hoje);
    const dias = await this.gateway.buscar(inicio, hoje);

    const datas = dias.map((d) => paraDate(d.data));
    const existentes = new Set(
      (
        await this.prisma.cdiDia.findMany({
          where: { data: { in: datas } },
          select: { data: true },
        })
      ).map((e) => dataIsoDe(e.data)),
    );
    const novos = dias.filter((d) => !existentes.has(d.data));

    if (novos.length > 0) {
      await this.prisma.cdiDia.createMany({
        data: novos.map((d) => ({ data: paraDate(d.data), taxaE8: d.taxaE8 })),
        skipDuplicates: true,
      });
    }
    return { dias: dias.length, novos: novos.length };
  }

  /**
   * Do dia mais antigo que importa até hoje: se existe movimento anterior ao primeiro CDI gravado,
   * busca desde ele (backfill); senão relê só os últimos dias (o BCB raramente corrige, mas pode).
   */
  private async inicioDaBusca(hoje: DataIso): Promise<DataIso> {
    const [movimento, cdi] = await Promise.all([
      this.prisma.movimentoCaixinha.aggregate({ _min: { data: true } }),
      this.prisma.cdiDia.aggregate({ _min: { data: true }, _max: { data: true } }),
    ]);
    const primeiroMovimento = movimento._min.data ? dataIsoDe(movimento._min.data) : null;
    const primeiroCdi = cdi._min.data ? dataIsoDe(cdi._min.data) : null;
    const ultimoCdi = cdi._max.data ? dataIsoDe(cdi._max.data) : null;

    if (primeiroCdi === null || ultimoCdi === null) {
      return primeiroMovimento ?? somarDias(hoje, -JANELA_SEM_DADOS_DIAS);
    }
    if (primeiroMovimento !== null && primeiroMovimento < primeiroCdi) {
      return primeiroMovimento;
    }
    return somarDias(ultimoCdi, -JANELA_RELEITURA_DIAS);
  }
}
