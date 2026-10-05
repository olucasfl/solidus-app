import { CdiIndisponivelError } from './carteira-errors';
import { BcbCdiGateway } from './cdi.gateway';

function resposta(corpo: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(corpo) } as unknown as Response;
}

describe('BcbCdiGateway (CA-18 e CA-19)', () => {
  const gateway = new BcbCdiGateway();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    jest.spyOn(gateway['logger'], 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('monta a URL da série 12 no formato do BCB e converte a resposta sem float', async () => {
    fetchMock.mockResolvedValue(
      resposta([
        { data: '02/01/2026', valor: '0.055131' },
        { data: '05/01/2026', valor: '0.055132' },
      ]),
    );

    const dias = await gateway.buscar('2026-01-01', '2026-01-31');

    expect(dias).toEqual([
      { data: '2026-01-02', taxaE8: 55_131 },
      { data: '2026-01-05', taxaE8: 55_132 },
    ]);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/bcdata.sgs.12/dados');
    expect(url).toContain('formato=json');
    expect(url).toContain('dataInicial=01%2F01%2F2026');
    expect(url).toContain('dataFinal=31%2F01%2F2026');
  });

  it('formato REAL da API do BCB (resposta capturada em 2026-10-05, série 12)', async () => {
    // Corpo exatamente como o Banco Central devolveu: strings, data dd/MM/yyyy, valor em % ao dia.
    fetchMock.mockResolvedValue(
      resposta([
        { data: '30/09/2026', valor: '0.050788' },
        { data: '01/10/2026', valor: '0.050788' },
        { data: '02/10/2026', valor: '0.050788' },
      ]),
    );

    await expect(gateway.buscar('2026-09-30', '2026-10-02')).resolves.toEqual([
      { data: '2026-09-30', taxaE8: 50_788 },
      { data: '2026-10-01', taxaE8: 50_788 },
      { data: '2026-10-02', taxaE8: 50_788 },
    ]);
  });

  it('resposta vazia é válida (nenhum dia útil no intervalo)', async () => {
    fetchMock.mockResolvedValue(resposta([]));

    await expect(gateway.buscar('2026-01-03', '2026-01-04')).resolves.toEqual([]);
  });

  it.each([
    ['status de erro', resposta({}, false, 503)],
    ['corpo que não é lista', resposta({ erro: 'x' })],
    ['item sem valor', resposta([{ data: '02/01/2026' }])],
    ['valor com vírgula', resposta([{ data: '02/01/2026', valor: '0,055131' }])],
    ['valor com mais de 6 casas', resposta([{ data: '02/01/2026', valor: '0.0551311' }])],
    ['data fora do formato', resposta([{ data: '2026-01-02', valor: '0.055131' }])],
  ])('%s → CdiIndisponivelError genérico', async (_nome, r) => {
    fetchMock.mockResolvedValue(r);

    await expect(gateway.buscar('2026-01-01', '2026-01-31')).rejects.toThrow(CdiIndisponivelError);
  });

  it('falha de rede/timeout → CdiIndisponivelError, sem vazar o erro original', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.bcb.gov.br'));

    const erro = await gateway.buscar('2026-01-01', '2026-01-31').catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(CdiIndisponivelError);
    expect(JSON.stringify((erro as CdiIndisponivelError).getResponse())).not.toContain('ENOTFOUND');
  });
});
