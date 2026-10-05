/** Data de calendário `YYYY-MM-DD` (sem hora nem fuso): é assim que o domínio da carteira conta dias. */
export type DataIso = string;

const DIA_MS = 24 * 60 * 60 * 1000;
const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;

function paraUtc(data: DataIso): number {
  const m = FORMATO.exec(data);
  if (!m) {
    throw new TypeError(`Data inválida: ${data}`);
  }
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(ano, mes - 1, dia);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw new TypeError(`Data inexistente: ${data}`);
  }
  return ms;
}

export function ehDataIso(valor: unknown): valor is DataIso {
  if (typeof valor !== 'string') return false;
  try {
    paraUtc(valor);
    return true;
  } catch {
    return false;
  }
}

/** Dias corridos de `de` até `ate` (negativo se `ate` for anterior). */
export function diasEntre(de: DataIso, ate: DataIso): number {
  return Math.round((paraUtc(ate) - paraUtc(de)) / DIA_MS);
}

export function somarDias(data: DataIso, dias: number): DataIso {
  return new Date(paraUtc(data) + dias * DIA_MS).toISOString().slice(0, 10);
}

export function dataIsoDe(data: Date): DataIso {
  return data.toISOString().slice(0, 10);
}
