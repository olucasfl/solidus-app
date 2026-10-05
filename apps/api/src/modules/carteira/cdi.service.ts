import type { CdiSyncResponse } from '@solidus/shared';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { hojeUtc } from '../../common/relogio';
import { PrismaService } from '../../database/prisma.service';
import { type DataIso, dataIsoDe, diasEntre, somarDias } from '../../domain/carteira/datas';
import { CdiGateway } from './cdi.gateway';

const JANELA_RELEITURA_DIAS = 7;
const JANELA_SEM_DADOS_DIAS = 30;
/** Entre duas tentativas automáticas (o BCB pode estar fora do ar; não martelar). */
const INTERVALO_ENTRE_TENTATIVAS_MS = 15 * 60 * 1000;
/** Quanto uma consulta de carteira espera pela atualização antes de seguir com o que já tem. */
const ESPERA_MAXIMA_MS = 5_000;

function paraDate(data: DataIso): Date {
  return new Date(`${data}T00:00:00.000Z`);
}

@Injectable()
export class CdiService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CdiService.name);
  private ultimaTentativa = 0;
  private emAndamento: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CdiGateway,
  ) {}

  /** Ao subir, já tenta deixar o CDI em dia (sem bloquear o boot e sem derrubá-lo se falhar). */
  onApplicationBootstrap(): void {
    void this.atualizarSeNecessario(0);
  }

  /**
   * O CDI se mantém sozinho: quem precisa dele (carteira, boot) chama isto; se há saldo informado e o
   * CDI gravado está velho (ou falta histórico), busca no BCB. Nunca lança: falha do BCB deixa a
   * carteira responder com o que já tem (aviso `CDI_DEFASADO`). Limitada a uma tentativa a cada 15
   * minutos e com uma única busca por vez. O `POST /cdi/sincronizar` do cron continua existindo.
   */
  async atualizarSeNecessario(esperaMaximaMs = ESPERA_MAXIMA_MS): Promise<void> {
    if (!this.emAndamento && Date.now() - this.ultimaTentativa >= INTERVALO_ENTRE_TENTATIVAS_MS) {
      this.ultimaTentativa = Date.now();
      this.emAndamento = this.tentarAtualizar().finally(() => {
        this.emAndamento = null;
      });
    }
    if (this.emAndamento && esperaMaximaMs > 0) {
      await Promise.race([
        this.emAndamento,
        new Promise<void>((resolve) => setTimeout(resolve, esperaMaximaMs).unref()),
      ]);
    }
  }

  private async tentarAtualizar(): Promise<void> {
    try {
      if (await this.precisaAtualizar()) {
        await this.sincronizar();
      }
    } catch (error) {
      // O gateway já registrou o motivo (sem dado sensível); aqui só o nome do erro.
      this.logger.warn(`CDI não atualizado (${error instanceof Error ? error.name : 'erro'})`);
    }
  }

  /** Só vale buscar se existe algum movimento (senão não há o que calcular) e o CDI está atrás. */
  private async precisaAtualizar(): Promise<boolean> {
    const [movimento, cdi] = await Promise.all([
      this.prisma.movimentoCaixinha.aggregate({ _min: { data: true } }),
      this.prisma.cdiDia.aggregate({ _min: { data: true }, _max: { data: true } }),
    ]);
    if (!movimento._min.data) return false;
    if (!cdi._max.data || !cdi._min.data) return true;

    const ultimoCdi = dataIsoDe(cdi._max.data);
    const primeiroCdi = dataIsoDe(cdi._min.data);
    const faltaHistorico = dataIsoDe(movimento._min.data) < primeiroCdi;
    return faltaHistorico || diasEntre(ultimoCdi, hojeUtc()) > 1;
  }

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
