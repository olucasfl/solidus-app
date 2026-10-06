import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = __dirname;
const MODELOS_DO_USUARIO = [
  'conta',
  'transacao',
  'syncRun',
  'regraCategoria',
  'caixinha',
  'movimentoCaixinha',
  'fonteRenda',
  'conexaoPluggy',
  'configuracaoReserva',
];
const OPERACOES = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'create',
  'createMany',
  'upsert',
];

function arquivosDeProducao(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      return arquivosDeProducao(caminho);
    }
    return caminho.endsWith('.ts') && !caminho.endsWith('.spec.ts') ? [caminho] : [];
  });
}

/** Devolve o texto dos argumentos da chamada que começa em `abre` (o "(" da chamada). */
function argumentos(fonte: string, abre: number): string {
  let nivel = 0;
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === '(') nivel++;
    if (fonte[i] === ')' && --nivel === 0) return fonte.slice(abre, i + 1);
  }
  return fonte.slice(abre);
}

// Cada acesso ao banco de um dado do usuário tem que mencionar `userId` (spec 06): é a rede de
// segurança contra o esquecimento de um filtro — o Prisma ignora RLS, o isolamento é feito aqui.
describe('isolamento por usuário (spec 06)', () => {
  const padrao = new RegExp(
    String.raw`\.(${MODELOS_DO_USUARIO.join('|')})\.(${OPERACOES.join('|')})\(`,
    'g',
  );

  it.each(arquivosDeProducao(join(RAIZ, '..')).map((a) => [a.slice(RAIZ.length - 7), a]))(
    '%s: toda chamada a dado do usuário filtra ou grava por userId',
    (_nome, arquivo) => {
      const fonte = readFileSync(arquivo, 'utf-8');
      const semFiltro: string[] = [];
      for (const m of fonte.matchAll(padrao)) {
        const args = argumentos(fonte, m.index + m[0].length - 1);
        // `donoId` é o userId do dono no sync; `isolamento-global` marca (com justificativa) o que é
        // público de propósito. O `upsert` de Conta do sync: o dono é conferido antes (findUnique) e gravado no create.
        if (
          !args.includes('userId') &&
          !args.includes('donoId') &&
          !args.includes('isolamento-global')
        ) {
          semFiltro.push(`${m[1]}.${m[2]}`);
        }
      }
      expect(semFiltro).toEqual([]);
    },
  );
});
