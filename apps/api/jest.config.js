// Config do Jest da API. Estava no package.json (JSON nao aceita comentario); o conteudo e o
// mesmo, mais o testTimeout.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testTimeout: 20_000,
};
