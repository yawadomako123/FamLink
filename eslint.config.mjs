import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 exports flat configs directly, so no FlatCompat shim.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      'public/sw.js',
      'next-env.d.ts',
      'scratch-*',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Location data must never reach the browser console.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Node-side scripts and tests are not part of the app bundle.
    files: ['scripts/**/*.{ts,mjs}', 'tests/**/*.ts', '*.config.{ts,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;
