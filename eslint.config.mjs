import js from '@eslint/js';
import globals from 'globals';

/**
 * Lint gate (GODS-EYE-VIEW-SPEC v2, Part 8).
 *
 * Code written for v2 must pass the recommended rules with zero findings.
 * The inherited code base predates this linter: its existing findings (mostly
 * unused variables) are reported as warnings so they stay visible without
 * forcing a rewrite of working modules. Errors fail `npm run lint`; warnings
 * do not.
 */

/** Modules written for v2 — strict. Add new v2 modules here. */
const V2_FILES = [
  'server/providers/gateway/**/*.js',
  'server/providers/airports/**/*.js',
  'server/providers/aircraft/viewport.js',
  'server/providers/aircraft/viewportRoute.js',
  'src/gateway/**/*.mjs',
  'src/search/airportGeocoder.js',
  'src/search/airportGeocoder.test.mjs',
  'src/ui/systemStatus.js',
  'src/ui/systemStatus.test.mjs',
  'server/providers/aviationWeather/**/*.js',
  'src/audio/**/*.{js,mjs}',
  'src/ui/cockpitAtc.js',
  'src/ui/cockpitAtc.test.mjs',
  'server/providers/audio/**/*.js',
  'server/providers/trafficIncidents/**/*.js',
  'server/providers/cctv/cadence.js',
  'src/layers/trafficIncidents/**/*.js',
  'src/ui/audioSourcesDialog.js',
  'src/ui/cctvRate.js',
  'src/ui/cctvRate.test.mjs',
  'server/providers/nws/**/*.js',
  'server/providers/eonet/**/*.js',
  'server/providers/facilities/**/*.js',
  'server/providers/whisper/**/*.js',
  'src/voice/local/**/*.js',
  'src/ui/voiceSettings.js',
  'server/providers/transitAgencies.js',
  'src/data/transitAgencyConfig.js',
  'server/providers/usgs.js',
  'src/alerts/**/*.{js,mjs}',
  'src/layers/nwsWarnings/**/*.js',
  'src/layers/naturalEvents/**/*.js',
  'src/layers/emergencyFacilities/**/*.js',
  'src/ui/alertsPanel.js',
  'eslint.config.mjs',
];

const inheritedAsWarnings = Object.fromEntries(
  Object.keys(js.configs.recommended.rules).map((rule) => [rule, 'warn']),
);

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'data/**',
      '.gev-cache/**',
      '.gev-logs/**',
      'public/**',
      'pinokio/**',
      'src/data/local_data/**',
      'output/**',
      'screenshots/**',
      'qa-shots/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: inheritedAsWarnings,
  },
  {
    files: V2_FILES,
    rules: js.configs.recommended.rules,
  },
];
