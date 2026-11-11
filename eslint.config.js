// ESLint flat config (ESLint 9+).
// Intentionally lenient: it catches REAL problems (undefined variables, syntax
// errors, obvious bugs) without drowning the existing codebase in style noise.
// Tighten rules over time as the team agrees on conventions.

const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,

  // Ignore generated / vendored / data files.
  {
    ignores: [
      'node_modules/**',
      'archive/**',
      '_shots/**',
      'hop-migration/**',
      'public/data/**',
      'data/**',
      '**/*.min.js'
    ]
  },

  // Backend (Node/CommonJS).
  {
    files: ['**/*.js'],
    ignores: ['public/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', exports: 'writable',
        process: 'readonly', __dirname: 'readonly', __filename: 'readonly',
        console: 'readonly', Buffer: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        fetch: 'readonly', URL: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }]
    }
  },

  // Frontend (browser globals, classic scripts — not modules).
  // These files intentionally share a single global scope: each defines a module
  // (const Trends = …) that others reference via window./typeof guards. That's the
  // app's deliberate pattern, so `no-redeclare` is disabled here.
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', console: 'readonly',
        fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        localStorage: 'readonly', location: 'readonly', navigator: 'readonly',
        Chart: 'readonly', io: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        Event: 'readonly',
        // App modules — each is defined in one classic script and referenced by
        // the others at the shared global scope. no-redeclare is off (below) so
        // the defining file doesn't flag; listing them here satisfies no-undef
        // in the referencing files.
        App: 'readonly', Charts: 'readonly', Trends: 'readonly',
        Insights: 'readonly', Alerts: 'readonly', SocketManager: 'readonly',
        SearchableSelect: 'readonly', Assistant: 'readonly', FileDetails: 'readonly',
        PentahoDataService: 'readonly', PENTAHO_AI_ISSUES: 'readonly'
      }
    },
    rules: {
      'no-redeclare': 'off',
      'no-unused-vars': ['warn', { args: 'none', vars: 'local', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }]
    }
  }
];
