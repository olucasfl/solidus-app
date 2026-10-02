#!/usr/bin/env node
// Bloqueia o commit se algum .env* (exceto .env.example) ou arquivo em spike-output/ estiver no
// stage. Roda no pre-commit, antes do lint-staged — defesa extra além do .gitignore (um
// `git add -f` ainda poderia forçar o arquivo para o stage).
import { execFileSync } from 'node:child_process';

const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const proibidos = staged.filter((path) => {
  const nome = path.split('/').pop() ?? path;
  const isEnvReal = /^\.env(\..+)?$/.test(nome) && nome !== '.env.example';
  const isSpikeOutput = path.startsWith('spike-output/');
  return isEnvReal || isSpikeOutput;
});

if (proibidos.length > 0) {
  console.error('Commit bloqueado — contém arquivo de ambiente real ou dado do spike:');
  for (const path of proibidos) {
    console.error(`  - ${path}`);
  }
  console.error('Remova do stage com: git restore --staged <arquivo>');
  process.exit(1);
}
