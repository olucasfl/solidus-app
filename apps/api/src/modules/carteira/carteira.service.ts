import type {
  AvisoCarteira,
  CaixinhaNaCarteira,
  Carteira,
  ConferenciaCaixinha,
} from '@solidus/shared';
import { Injectable } from '@nestjs/common';
import { hojeUtc } from '../../common/relogio';
import { PrismaService } from '../../database/prisma.service';
import { type DataIso, dataIsoDe, diasEntre, ehDataIso } from '../../domain/carteira/datas';
import { type Movimento, projetarCaixinha } from '../../domain/carteira/projetar';
import { totaisDaCarteira } from '../../domain/carteira/totais';
import { conferirCaixinha } from '../../domain/carteira/conferir';
import { CONVENCAO_PADRAO } from '../../domain/carteira/projetar';
import { CaixinhaNaoEncontradaError, dadoInvalido } from './carteira-errors';
import { CdiService } from './cdi.service';
import { ImpostosService } from './impostos.service';

@Injectable()
export class CarteiraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly impostos: ImpostosService,
    private readonly cdiService: CdiService,
  ) {}

  /**
   * Carteira em `data` (padrão: hoje, UTC). Antes de calcular, deixa o CDI em dia por conta própria
   * (best effort, com tempo máximo de espera): se o BCB falhar, responde com o que já tem e o aviso
   * `CDI_DEFASADO`. Só leitura para o usuário.
   */
  async consultar(userId: string, data?: string): Promise<Carteira> {
    const ate = data ?? hojeUtc();
    if (!ehDataIso(ate)) {
      throw dadoInvalido('DATA_INVALIDA', 'data deve ser uma data YYYY-MM-DD válida.');
    }
    if (diasEntre(hojeUtc(), ate) > 0) {
      throw dadoInvalido('DATA_FUTURA', 'data não pode estar no futuro.');
    }

    await this.cdiService.atualizarSeNecessario();

    const [caixinhas, cdiDias, iof, ir] = await Promise.all([
      this.prisma.caixinha.findMany({
        where: { userId },
        orderBy: { criadoEm: 'asc' },
        include: { movimentos: { orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }] } },
      }),
      this.prisma.cdiDia.findMany({ where: { data: { lte: new Date(`${ate}T00:00:00.000Z`) } } }),
      this.impostos.faixas('IOF'),
      this.impostos.faixas('IR'),
    ]);
    const cdi = new Map<DataIso, number>(cdiDias.map((d) => [dataIsoDe(d.data), d.taxaE8]));

    const resultado: CaixinhaNaCarteira[] = caixinhas.map((c) => {
      const movimentos: Movimento[] = c.movimentos.map((m) => ({
        tipo: m.tipo,
        data: dataIsoDe(m.data),
        valorCentavos: m.valorCentavos,
        dataOrigem: m.dataOrigem ? dataIsoDe(m.dataOrigem) : null,
      }));
      const p = projetarCaixinha({
        movimentos,
        percentualCdiBp: c.percentualCdiBp,
        cdi,
        ate,
        iof,
        ir,
        convencao: c.convencaoRendimento ?? CONVENCAO_PADRAO,
      });
      return {
        id: c.id,
        nome: c.nome,
        percentualCdiBp: c.percentualCdiBp,
        reservaDeGastos: c.reservaDeGastos,
        ativa: c.ativa,
        saldoInformado: p.saldoInformado,
        saldoBrutoEstimadoCentavos: p.saldoBrutoCentavos,
        rendimentoBrutoCentavos: p.rendimentoBrutoCentavos,
        impostos: p.impostos,
        saldoLiquidoEstimadoCentavos: p.saldoLiquidoCentavos,
        rendimentoLiquidoCentavos: p.rendimentoLiquidoCentavos,
        avisos: p.avisos,
      };
    });

    const avisos = new Set<AvisoCarteira>();
    for (const c of resultado.filter((x) => x.ativa)) {
      c.avisos.forEach((a) => avisos.add(a));
    }

    return {
      data: ate,
      caixinhas: resultado,
      totais: totaisDaCarteira(
        resultado.map((c) => ({
          ativa: c.ativa,
          reservaDeGastos: c.reservaDeGastos,
          saldoBrutoCentavos: c.saldoBrutoEstimadoCentavos,
        })),
      ),
      avisos: [...avisos],
    };
  }

  /**
   * O app se confere com os saldos que o usuário JÁ informou: para cada par de saldos consecutivos,
   * compara o que estimaria com o que ele informou, nas duas convenções, e sugere a que erra menos.
   */
  async conferir(userId: string, caixinhaId: string): Promise<ConferenciaCaixinha> {
    const caixinha = await this.prisma.caixinha.findFirst({
      where: { id: caixinhaId, userId },
      include: { movimentos: { orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }] } },
    });
    if (!caixinha) {
      throw new CaixinhaNaoEncontradaError();
    }
    await this.cdiService.atualizarSeNecessario();
    const cdiDias = await this.prisma.cdiDia.findMany();

    const conferencia = conferirCaixinha({
      movimentos: caixinha.movimentos.map((m) => ({
        tipo: m.tipo,
        data: dataIsoDe(m.data),
        valorCentavos: m.valorCentavos,
        dataOrigem: m.dataOrigem ? dataIsoDe(m.dataOrigem) : null,
      })),
      percentualCdiBp: caixinha.percentualCdiBp,
      cdi: new Map<DataIso, number>(cdiDias.map((d) => [dataIsoDe(d.data), d.taxaE8])),
    });

    return {
      caixinhaId,
      convencaoEmUso: caixinha.convencaoRendimento ?? CONVENCAO_PADRAO,
      ...conferencia,
    };
  }
}
