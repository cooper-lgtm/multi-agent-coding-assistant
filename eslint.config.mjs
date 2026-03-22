import js from '@eslint/js';
import globals from 'globals';
import eslintPluginYml from 'eslint-plugin-yml';
import tseslint from 'typescript-eslint';

const tsRecommendedRules = Object.assign(
  {},
  ...tseslint.configs.recommended.map((config) => config.rules ?? {}),
);

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'state/**'],
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-regex-spaces': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsRecommendedRules,
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-regex-spaces': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
  ...eslintPluginYml.configs.standard,
  {
    files: ['**/*.{yaml,yml}'],
    rules: {
      'yml/file-extension': 'off',
      'yml/quotes': 'off',
      'yml/sort-keys': 'off',
      'yml/spaced-comment': 'off',
    },
  },
];
