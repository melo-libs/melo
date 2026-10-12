import js from '@eslint/js'
import react from '@eslint-react/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettierRecommended from 'eslint-plugin-prettier/recommended'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['.reference/**', 'dist/**', 'out/**', 'release/**']),
  {
    files: ['**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, prettierRecommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { '@eslint-react': react, 'react-hooks': reactHooks },
    rules: {
      // JSX is TSX-only here, and components are functional; TypeScript covers
      // JSX names/props while these rules retain runtime React checks.
      '@eslint-react/dom-no-dangerously-set-innerhtml-with-children': 'error',
      '@eslint-react/dom-no-find-dom-node': 'error',
      '@eslint-react/dom-no-render': 'error',
      '@eslint-react/dom-no-render-return-value': 'error',
      '@eslint-react/dom-no-unknown-property': 'error',
      '@eslint-react/dom-no-unsafe-target-blank': 'error',
      '@eslint-react/dom-no-void-elements-with-children': 'error',
      '@eslint-react/jsx-no-children-prop': 'error',
      '@eslint-react/jsx-no-comment-textnodes': 'error',
      '@eslint-react/no-direct-mutation-state': 'error',
      '@eslint-react/no-missing-component-display-name': 'error',
      '@eslint-react/no-missing-context-display-name': 'error',
      '@eslint-react/no-missing-key': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends', allowObjectTypes: 'always' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'prettier/prettier': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
])
