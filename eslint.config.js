import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// 規格 Steps 1：禁止 innerHTML / dangerouslySetInnerHTML（所有使用者內容只能用 textContent 或 sanitize 過的 markdown）。
const noUnsafeHtml = [
  'error',
  {
    selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
    message: '禁止指派 innerHTML/outerHTML：改用 textContent 或 lib/sanitize 的 renderMarkdown。',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: '禁止 insertAdjacentHTML。',
  },
  {
    selector: "CallExpression[callee.property.name='write'][callee.object.name='document']",
    message: '禁止 document.write。',
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: '禁止 dangerouslySetInnerHTML：使用 lib/sanitize 的 SafeMarkdown 元件。',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-*/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.data/**',
      'tests/security/vectors/**',
      'tests/fixtures/**',
      'docs/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-restricted-syntax': noUnsafeHtml,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/no-danger': 'error',
      'react/jsx-no-target-blank': 'error',
    },
  },
);
