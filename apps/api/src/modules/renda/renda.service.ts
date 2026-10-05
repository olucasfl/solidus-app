import type {
  FonteDto,
  RecebimentoSalario,
  SalarioResponse,
  TrocarFonteSalarioResponse,
} from '@solidus/shared';
import { Injectable } from '@nestjs/common';
import { type FonteRenda } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { fonteDaTransacao, type FonteAplicavel } from '../../domain/renda/aplicar-fontes';
import { detectarRecorrentes } from '../../domain/renda/detectar-recorrentes';
import { CategorizacaoService } from '../categorizacao/categorizacao.service';
import {
  DataAnteriorAoInicioError,
  FonteJaExisteError,
  FonteNaoEncontradaError,
  FonteNaoVigenteError,
  MesmaOrigemError,
  NaoEEntradaError,
  SemContraparteError,
  TransacaoNaoEncontradaError,
} from './renda-errors';

const DIA_MS = 24 * 60 * 60 * 1000;
const HISTORICO_MAX = 240;
/** Só Pix/transferência entre pessoas pode virar renda recorrente (nunca fatura, aplicação ou conta própria). */
const CATEGORIAS_PLUGGY_PESSOAS = ['Transfers', 'Third party transfers'];

type FonteComId = FonteAplicavel & { id: string };

function dia(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function inicioDoDia(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function diaAnterior(data: Date): Date {
  return new Date(inicioDoDia(dia(data)).getTime() - DIA_MS);
}

function diaSeguinte(data: Date): Date {
  return new Date(inicioDoDia(dia(data)).getTime() + DIA_MS);
}

/**
 * Multiusuário (spec 06, mantido como defesa em profundidade): TODO método recebe o `userId` da
 * SESSÃO e filtra por ele. Recurso de outro usuário é "não encontrado" (404). A chave do documento
 * (`contraparteChave`) nunca sai daqui: os DTOs só levam nome e máscara.
 */
@Injectable()
export class RendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categorizacao: CategorizacaoService,
  ) {}

  /**
   * Origens de Pix de pessoas que pagaram em 3+ meses distintos viram fonte RECORRENTE automática
   * (renda). Quem já tem fonte (inclusive uma que o usuário DESATIVOU) não é recriada: o "não" do
   * usuário vale. Devolve quantas fontes nasceram; quem chama reaplica a categorização se > 0.
   */
  async reconhecerRecorrentes(userId: string): Promise<number> {
    const [creditos, existentes] = await Promise.all([
      this.prisma.transacao.findMany({
        where: {
          userId,
          tipo: 'CREDITO',
          contraparteChave: { not: null },
          categoriaPluggy: { in: CATEGORIAS_PLUGGY_PESSOAS },
        },
        select: {
          contraparteChave: true,
          contraparteNome: true,
          contraparteDocMascarado: true,
          data: true,
        },
        orderBy: { data: 'desc' },
      }),
      this.prisma.fonteRenda.findMany({ where: { userId }, select: { contraparteChave: true } }),
    ]);

    const jaTem = new Set(existentes.map((e) => e.contraparteChave));
    const novos = detectarRecorrentes(
      creditos.flatMap((c) =>
        c.contraparteChave ? [{ chave: c.contraparteChave, data: c.data }] : [],
      ),
    ).filter((r) => !jaTem.has(r.chave));
    if (novos.length === 0) {
      return 0;
    }

    // `creditos` vem do mais recente para o mais antigo: o primeiro de cada chave dá nome e máscara.
    const exibicao = new Map<string, { nome: string | null; doc: string | null }>();
    for (const c of creditos) {
      if (c.contraparteChave && !exibicao.has(c.contraparteChave)) {
        exibicao.set(c.contraparteChave, {
          nome: c.contraparteNome,
          doc: c.contraparteDocMascarado,
        });
      }
    }

    await this.prisma.fonteRenda.createMany({
      data: novos.map((r) => ({
        userId,
        tipo: 'RECORRENTE' as const,
        origem: 'AUTOMATICA' as const,
        contraparteChave: r.chave,
        nome: exibicao.get(r.chave)?.nome ?? null,
        docMascarado: exibicao.get(r.chave)?.doc ?? null,
        vigenteDesde: inicioDoDia(dia(r.desde)),
      })),
    });
    return novos.length;
  }

  async salario(userId: string): Promise<SalarioResponse> {
    const fontes = await this.prisma.fonteRenda.findMany({
      where: { userId, tipo: 'SALARIO' },
      orderBy: [{ vigenteDesde: 'desc' }, { id: 'asc' }],
    });
    const aplicaveis = fontes.map((f) => this.paraAplicavel(f));
    const linhas = await this.prisma.transacao.findMany({
      where: { userId, categoria: 'SALARIO', tipo: 'CREDITO' },
      orderBy: [{ data: 'desc' }, { id: 'asc' }],
      take: HISTORICO_MAX,
      select: { id: true, data: true, valorCentavos: true, tipo: true, contraparteChave: true },
    });

    const historico: RecebimentoSalario[] = linhas.map((l) => ({
      data: l.data.toISOString(),
      valorCentavos: l.valorCentavos,
      fonteId:
        fonteDaTransacao(
          { tipo: l.tipo, contraparteChave: l.contraparteChave, data: l.data },
          aplicaveis,
        )?.id ?? null,
      transacaoId: l.id,
    }));

    const atuais = fontes.filter((f) => f.ativa && f.vigenteAte === null);
    // `historico` está do mais recente para o mais antigo: o primeiro de cada fonte é o último recebimento.
    const ultimos = atuais
      .map((f) => historico.find((h) => h.fonteId === f.id))
      .filter((h): h is RecebimentoSalario => h !== undefined);

    return {
      fontesAtuais: atuais.map((f) => this.paraDto(f)),
      valorAtualCentavos:
        ultimos.length === 0 ? null : ultimos.reduce((soma, h) => soma + h.valorCentavos, 0),
      historico,
      fontes: fontes.map((f) => this.paraDto(f)),
    };
  }

  /** "Esse pagamento é o meu salário": adiciona uma fonte SEM encerrar as outras. */
  async definirFonteSalario(userId: string, transacaoId: string): Promise<FonteDto> {
    const origem = await this.origemDaTransacao(userId, transacaoId);

    const daOrigem = await this.prisma.fonteRenda.findMany({
      where: { userId, contraparteChave: origem.chave },
    });
    if (daOrigem.some((f) => f.tipo === 'SALARIO' && f.ativa && f.vigenteAte === null)) {
      throw new FonteJaExisteError();
    }

    let fonte: FonteRenda;
    const recorrente = daOrigem.find((f) => f.tipo === 'RECORRENTE');
    if (recorrente) {
      // O usuário promove a origem que o Solidus já tinha reconhecido: a decisão manual manda.
      fonte = await this.prisma.fonteRenda.update({
        where: { id: recorrente.id, userId },
        data: { tipo: 'SALARIO', origem: 'MANUAL', ativa: true, vigenteAte: null },
      });
    } else {
      fonte = await this.prisma.fonteRenda.create({
        data: {
          userId,
          tipo: 'SALARIO',
          origem: 'MANUAL',
          contraparteChave: origem.chave,
          nome: origem.nome,
          docMascarado: origem.docMascarado,
          vigenteDesde: await this.inicioDaNovaFonte(userId, origem.chave, origem.data, daOrigem),
        },
      });
    }

    await this.categorizacao.recalcular(userId);
    return this.paraDto(fonte);
  }

  /**
   * "Trocar de onde vem": encerra a fonte escolhida no dia anterior à transação nova e abre a nova
   * a partir desse dia. O que já foi recebido da origem antiga continua salário dela; nada do
   * passado é reescrito. As outras fontes de salário não são tocadas.
   */
  async trocarFonteSalario(
    userId: string,
    fonteId: string,
    transacaoId: string,
  ): Promise<TrocarFonteSalarioResponse> {
    const atual = await this.prisma.fonteRenda.findFirst({ where: { id: fonteId, userId } });
    if (!atual) {
      throw new FonteNaoEncontradaError();
    }
    if (atual.tipo !== 'SALARIO' || !atual.ativa || atual.vigenteAte !== null) {
      throw new FonteNaoVigenteError();
    }

    const origem = await this.origemDaTransacao(userId, transacaoId);
    if (origem.chave === atual.contraparteChave) {
      throw new MesmaOrigemError();
    }
    const jaVigente = await this.prisma.fonteRenda.findFirst({
      where: {
        userId,
        contraparteChave: origem.chave,
        tipo: 'SALARIO',
        ativa: true,
        vigenteAte: null,
      },
      select: { id: true },
    });
    if (jaVigente) {
      throw new FonteJaExisteError();
    }

    const encerraEm = diaAnterior(origem.data);
    if (dia(encerraEm) < dia(atual.vigenteDesde)) {
      throw new DataAnteriorAoInicioError();
    }

    const [encerrada, nova] = await this.prisma.$transaction([
      this.prisma.fonteRenda.update({
        where: { id: atual.id, userId },
        data: { vigenteAte: encerraEm },
      }),
      this.prisma.fonteRenda.create({
        data: {
          userId,
          tipo: 'SALARIO',
          origem: 'MANUAL',
          contraparteChave: origem.chave,
          nome: origem.nome,
          docMascarado: origem.docMascarado,
          vigenteDesde: inicioDoDia(dia(origem.data)),
        },
      }),
    ]);

    await this.categorizacao.recalcular(userId);
    return { encerrada: this.paraDto(encerrada), nova: this.paraDto(nova) };
  }

  async listarFontes(userId: string): Promise<FonteDto[]> {
    const fontes = await this.prisma.fonteRenda.findMany({
      where: { userId },
      orderBy: [{ vigenteDesde: 'desc' }, { id: 'asc' }],
    });
    return fontes.map((f) => this.paraDto(f));
  }

  async ativarFonte(userId: string, id: string, ativa: boolean): Promise<FonteDto> {
    const atual = await this.prisma.fonteRenda.findFirst({ where: { id, userId } });
    if (!atual) {
      throw new FonteNaoEncontradaError();
    }
    const fonte = await this.prisma.fonteRenda.update({ where: { id, userId }, data: { ativa } });
    await this.categorizacao.recalcular(userId);
    return this.paraDto(fonte);
  }

  /** A transação apontada pelo usuário, validada: dele, de entrada e com quem pagou. */
  private async origemDaTransacao(userId: string, transacaoId: string) {
    const t = await this.prisma.transacao.findFirst({
      where: { id: transacaoId, userId },
      select: {
        tipo: true,
        data: true,
        contraparteChave: true,
        contraparteNome: true,
        contraparteDocMascarado: true,
      },
    });
    if (!t) {
      throw new TransacaoNaoEncontradaError();
    }
    if (t.tipo !== 'CREDITO') {
      throw new NaoEEntradaError();
    }
    if (!t.contraparteChave) {
      throw new SemContraparteError();
    }
    return {
      chave: t.contraparteChave,
      nome: t.contraparteNome,
      docMascarado: t.contraparteDocMascarado,
      data: t.data,
    };
  }

  /**
   * A fonte vale desde o PRIMEIRO recebimento da origem (o histórico todo vira salário). Se a origem
   * já teve fonte de salário encerrada, começa no dia seguinte ao fim dela, para as vigências não
   * se sobreporem.
   */
  private async inicioDaNovaFonte(
    userId: string,
    chave: string,
    dataDaTransacao: Date,
    daOrigem: readonly FonteRenda[],
  ): Promise<Date> {
    const fins = daOrigem
      .filter((f) => f.tipo === 'SALARIO' && f.vigenteAte !== null)
      .map((f) => f.vigenteAte as Date);
    if (fins.length > 0) {
      return diaSeguinte(new Date(Math.max(...fins.map((d) => d.getTime()))));
    }
    const { _min } = await this.prisma.transacao.aggregate({
      where: { userId, tipo: 'CREDITO', contraparteChave: chave },
      _min: { data: true },
    });
    return inicioDoDia(dia(_min.data ?? dataDaTransacao));
  }

  private paraAplicavel(f: FonteRenda): FonteComId {
    return {
      id: f.id,
      tipo: f.tipo,
      chave: f.contraparteChave,
      vigenteDesde: f.vigenteDesde,
      vigenteAte: f.vigenteAte,
      ativa: f.ativa,
    };
  }

  /** Nunca inclui `contraparteChave`: só o que serve para exibir. */
  private paraDto(f: FonteRenda): FonteDto {
    return {
      id: f.id,
      tipo: f.tipo,
      origem: f.origem,
      nome: f.nome,
      docMascarado: f.docMascarado,
      vigenteDesde: dia(f.vigenteDesde),
      vigenteAte: f.vigenteAte ? dia(f.vigenteAte) : null,
      ativa: f.ativa,
    };
  }
}
