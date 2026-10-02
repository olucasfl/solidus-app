import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'spike-output/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  // Frontend (apps/web) — ainda so o placeholder, mas a regra ja vale quando o codigo chegar.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  // Backend (NestJS depende de decorators e de parameter properties)
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      // Modulos vazios como marcadores de estrutura sao idiomaticos no Nest.
      '@typescript-eslint/no-extraneous-class': 'off',
      // `import type` apaga o import no JS emitido e quebra o emitDecoratorMetadata,
      // do qual a injecao de dependencia do Nest depende.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  prettier,
);
