const globals = require('globals');
const prettier = require('eslint-config-prettier');

/**
 * Flat ESLint config for Active Class.
 * Goal of phase 0: surface real bugs (undeclared vars, swallowed errors,
 * loose equality) without drowning in style noise (Prettier owns style).
 */
module.exports = [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'backups/**',
      'public/uploads/**',
      'public/assets/**', // vendored third-party libs (qrcode.js, etc.)
      'dist/**',
      'out/**',
      '.history/**',
      '**/*.min.js',
      'tests/__pw_*.cjs', // legacy incomplete debug scratch files (removed in cleanup)
    ],
  },

  // Main process + server + tooling (Node / CommonJS)
  {
    files: ['main.js', 'preload.js', 'server/**/*.js', 'tools/**/*.js', 'test_ai.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['warn', 'smart'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: false }],
      'no-undef': 'error',
      'no-var': 'warn',
      'prefer-const': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
    },
  },

  // Renderer (browser) code
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Exposed via preload contextBridge
        api: 'readonly',
      },
    },
    rules: {
      eqeqeq: ['warn', 'smart'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: false }],
      'no-undef': 'off', // many cross-file globals via <script> tags; revisit per-file later
      'no-var': 'warn',
      'prefer-const': 'warn',
    },
  },

  prettier,
];
