import type { FaixaImposto, ImpostosResponse, TipoImposto } from '@solidus/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { validarFaixas } from '../../domain/carteira/validar-faixas';
import { dadoInvalido } from './carteira-errors';

/** Ordem de leitura: pela idade máxima crescente, "sem limite" (null) por último. */
function porIdade(a: FaixaImposto, b: FaixaImposto): number {
  return (a.ateDias ?? Number.POSITIVE_INFINITY) - (b.ateDias ?? Number.POSITIVE_INFINITY);
}

@Injectable()
export class ImpostosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<ImpostosResponse> {
    return { IR: await this.faixas('IR'), IOF: await this.faixas('IOF') };
  }

  async faixas(tipo: TipoImposto): Promise<FaixaImposto[]> {
    const linhas = await this.prisma.faixaImposto.findMany({ where: { tipo } });
    return linhas.map((l) => ({ ateDias: l.ateDias, aliquotaBp: l.aliquotaBp })).sort(porIdade);
  }

  /** Substitui a tabela inteira do tipo. Valida ANTES de mexer: se falhar, a anterior permanece. */
  async substituir(tipo: TipoImposto, faixas: FaixaImposto[]): Promise<FaixaImposto[]> {
    const problemas = validarFaixas(faixas);
    if (problemas.length > 0) {
      throw dadoInvalido('FAIXAS_INVALIDAS', 'Tabela de imposto inválida.', { problemas });
    }
    await this.prisma.$transaction([
      this.prisma.faixaImposto.deleteMany({ where: { tipo } }),
      this.prisma.faixaImposto.createMany({
        data: faixas.map((f) => ({ tipo, ateDias: f.ateDias, aliquotaBp: f.aliquotaBp })),
      }),
    ]);
    return [...faixas].sort(porIdade);
  }
}
