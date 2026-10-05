import { CATEGORIA_IDS, type CategoriaId } from '@solidus/shared';
import { calcularPoupanca, type GrupoMovimento } from './calcular';

const g = (
  categoria: CategoriaId | null,
  totalCentavos: number,
  quantidade = 1,
  tipo: 'DEBITO' | 'CREDITO' = totalCentavos < 0 ? 'DEBITO' : 'CREDITO',
): GrupoMovimento => ({ categoria, tipo, quantidade, totalCentavos });

describe('calcularPoupanca', () => {
  it('CA-01: receitas 10.000 e despesas 6.000 → poupança 4.000 e taxa 40%', () => {
    const r = calcularPoupanca('2026-09', [g('SALARIO', 1_000_000), g('MERCADO', -600_000)]);

    expect(r).toMatchObject({
      receitasCentavos: 1_000_000,
      despesasCentavos: 600_000,
      poupancaCentavos: 400_000,
      taxaBasisPoints: 4000,
      avisos: [],
    });
  });

  it('CA-02: neutras (aporte, fatura, transferência própria) ficam fora e só são contadas', () => {
    const r = calcularPoupanca('2026-09', [
      g('SALARIO', 100_000),
      g('MERCADO', -40_000),
      g('INVESTIMENTO', -500_000, 3),
      g('PAGAMENTO_FATURA', -300_000, 2, 'DEBITO'),
      g('PAGAMENTO_FATURA', 300_000, 2, 'CREDITO'),
      g('TRANSFERENCIA_INTERNA', 90_000, 1),
    ]);

    expect(r.receitasCentavos).toBe(100_000);
    expect(r.despesasCentavos).toBe(40_000);
    expect(r.neutras.quantidade).toBe(8);
    expect(r.transacoes).toBe(1 + 1 + 3 + 2 + 2 + 1);
  });

  it('CA-03: estorno reduz a despesa da categoria', () => {
    const r = calcularPoupanca('2026-09', [
      g('COMPRAS', -50_000, 2, 'DEBITO'),
      g('COMPRAS', 10_000, 1, 'CREDITO'),
      g('SALARIO', 100_000),
    ]);

    expect(r.despesasCentavos).toBe(40_000);
    expect(r.porCategoria.find((c) => c.categoria === 'COMPRAS')).toMatchObject({
      quantidade: 3,
      totalCentavos: -40_000,
    });
  });

  it('CA-04: indefinidas e sem categoria ficam fora da fórmula e são reportadas', () => {
    const r = calcularPoupanca('2026-09', [
      g('SALARIO', 100_000),
      g('MERCADO', -40_000),
      g('A_CLASSIFICAR', 300_000, 1, 'CREDITO'),
      g('A_CLASSIFICAR', -20_000, 1, 'DEBITO'),
      g(null, -5_000, 1, 'DEBITO'),
    ]);

    expect(r.receitasCentavos).toBe(100_000);
    expect(r.despesasCentavos).toBe(40_000);
    expect(r.indefinidas).toEqual({
      quantidade: 3,
      entradasCentavos: 300_000,
      saidasCentavos: 25_000,
    });
    expect(r.avisos).toContain('ENTRADAS_A_CLASSIFICAR');
    expect(r.porCategoria.find((c) => c.categoria === 'SEM_CATEGORIA')).toMatchObject({
      natureza: 'INDEFINIDA',
      totalCentavos: -5_000,
    });
  });

  it('CA-04b: Pix de e para pessoas ficam fora da conta, mas são reportados e geram aviso', () => {
    const r = calcularPoupanca('2026-09', [
      g('SALARIO', 100_000),
      g('MERCADO', -30_000),
      g('PIX_RECEBIDO_DE_PESSOAS', 80_000, 3, 'CREDITO'),
      g('PIX_ENVIADO_PARA_PESSOAS', -45_000, 4, 'DEBITO'),
    ]);

    expect(r.receitasCentavos).toBe(100_000);
    expect(r.despesasCentavos).toBe(30_000);
    expect(r.pixPessoas).toEqual({
      quantidade: 7,
      entradasCentavos: 80_000,
      saidasCentavos: 45_000,
    });
    expect(r.avisos).toContain('PIX_ENTRE_PESSOAS_FORA_DA_CONTA');
    expect(r.avisos).not.toContain('ENTRADAS_A_CLASSIFICAR');
    expect(r.neutras.quantidade).toBe(7);
  });

  it('CA-04b: sem Pix entre pessoas não há aviso; categoria antiga desconhecida é indefinida', () => {
    const r = calcularPoupanca('2026-09', [
      g('SALARIO', 100_000),
      g('TRANSFERENCIAS_ENVIADAS' as never, -9_000, 2, 'DEBITO'),
    ]);

    expect(r.pixPessoas.quantidade).toBe(0);
    expect(r.avisos).not.toContain('PIX_ENTRE_PESSOAS_FORA_DA_CONTA');
    expect(r.indefinidas).toMatchObject({ quantidade: 2, saidasCentavos: 9_000 });
  });

  it('CA-05: sem receita não divide por zero', () => {
    const r = calcularPoupanca('2026-09', [g('MERCADO', -10_000)]);

    expect(r.taxaBasisPoints).toBeNull();
    expect(r.poupancaCentavos).toBe(-10_000);
    expect(r.avisos).toEqual(['SEM_RECEITA']);
  });

  it('CA-06: arredondamento em pontos-base e taxa negativa', () => {
    const taxa = (receitas: number, despesas: number) =>
      calcularPoupanca('2026-09', [g('SALARIO', receitas), g('MERCADO', -despesas)])
        .taxaBasisPoints;

    expect(taxa(300, 200)).toBe(3333);
    expect(taxa(300, 100)).toBe(6667);
    expect(taxa(400, 500)).toBe(-2500);
    expect(taxa(400, 400)).toBe(0);
  });

  it('CA-07: mês vazio', () => {
    const r = calcularPoupanca('2026-09', []);

    expect(r).toEqual({
      mes: '2026-09',
      receitasCentavos: 0,
      despesasCentavos: 0,
      poupancaCentavos: 0,
      taxaBasisPoints: null,
      transacoes: 0,
      neutras: { quantidade: 0 },
      indefinidas: { quantidade: 0, entradasCentavos: 0, saidasCentavos: 0 },
      pixPessoas: { quantidade: 0, entradasCentavos: 0, saidasCentavos: 0 },
      porCategoria: [],
      avisos: ['SEM_TRANSACOES', 'SEM_RECEITA'],
    });
  });

  it('CA-08: porCategoria agrupa tipos da mesma categoria, ordena por módulo e soma = total', () => {
    const r = calcularPoupanca('2026-09', [
      g('SALARIO', 100_000, 1),
      g('MERCADO', -30_000, 4),
      g('LAZER', -5_000, 2),
      g('RENDIMENTOS_CASHBACK', 700, 3),
    ]);

    expect(r.porCategoria.map((c) => c.categoria)).toEqual([
      'SALARIO',
      'MERCADO',
      'LAZER',
      'RENDIMENTOS_CASHBACK',
    ]);
    expect(r.porCategoria.reduce((s, c) => s + c.quantidade, 0)).toBe(r.transacoes);
  });

  it('despesa nula não vira -0', () => {
    const r = calcularPoupanca('2026-09', [g('SALARIO', 100)]);

    expect(Object.is(r.despesasCentavos, 0)).toBe(true);
    expect(Object.is(r.taxaBasisPoints, 10_000)).toBe(true);
  });

  it('CA-13: 200 conjuntos aleatórios → tudo inteiro e identidade receitas − despesas = poupança', () => {
    let semente = 42;
    const aleatorio = (): number => {
      semente = (semente * 1_103_515_245 + 12_345) % 2_147_483_648;
      return semente / 2_147_483_648;
    };

    for (let i = 0; i < 200; i += 1) {
      const grupos: GrupoMovimento[] = Array.from(
        { length: 1 + Math.floor(aleatorio() * 8) },
        () => {
          const categoria =
            aleatorio() < 0.1
              ? null
              : (CATEGORIA_IDS[Math.floor(aleatorio() * CATEGORIA_IDS.length)] as CategoriaId);
          const total = Math.round((aleatorio() - 0.5) * 2_000_000);
          return g(categoria, total, 1 + Math.floor(aleatorio() * 5));
        },
      );

      const r = calcularPoupanca('2026-09', grupos);

      for (const n of [
        r.receitasCentavos,
        r.despesasCentavos,
        r.poupancaCentavos,
        r.transacoes,
        r.neutras.quantidade,
        r.indefinidas.entradasCentavos,
        r.indefinidas.saidasCentavos,
        ...(r.taxaBasisPoints === null ? [] : [r.taxaBasisPoints]),
      ]) {
        expect(Number.isInteger(n)).toBe(true);
      }
      expect(r.receitasCentavos - r.despesasCentavos).toBe(r.poupancaCentavos);
      expect(r.porCategoria.reduce((s, c) => s + c.quantidade, 0)).toBe(r.transacoes);
    }
  });
});
