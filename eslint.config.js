import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
    { ignores: ['dist/**', 'coverage/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.{ts,tsx}'],
        plugins: {
            react,
            'react-hooks': reactHooks,
        },
        languageOptions: {
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
            globals: {
                ...globals.browser,
            },
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
        rules: {
            ...react.configs.recommended.rules,
            // New JSX transform: no need to import React in scope.
            'react/react-in-jsx-scope': 'off',
            // TypeScript interfaces already type props; prop-types is redundant here.
            'react/prop-types': 'off',
            // Apostrophes/quotes in JSX text render fine — this rule is noise.
            'react/no-unescaped-entities': 'off',
            // Classic, well-understood hooks rules. We intentionally do NOT enable the newer
            // react-hooks "recommended" React Compiler suite (purity/set-state-in-effect/…),
            // which flags idiomatic patterns like Date.now() initial state and async hydration.
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },
    {
        // Extension service worker + offscreen document — plain browser/worker JS with chrome APIs.
        files: ['public/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.serviceworker,
                chrome: 'readonly',
            },
        },
    },
    // Must stay last: disables ESLint rules that would fight Prettier's formatting.
    prettier,
);
