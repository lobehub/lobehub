/**
 * @type {import('@cucumber/cucumber').IConfiguration}
 */
const reportsEnabled = !['0', 'false'].includes(String(process.env.E2E_REPORTS).toLowerCase());
const parsedParallel = Number(process.env.E2E_PARALLEL || process.env.CUCUMBER_PARALLEL || 1);
const requestedParallel = Number.isFinite(parsedParallel) ? parsedParallel : 1;
const canRunInParallel = Boolean(process.env.BASE_URL);
// `@perf` scenarios need a `LOBE_REACT_PROFILING=1` build and run on their own
// (`bun run test:perf`), so the ordinary suite skips them.
const perfRun = process.env.E2E_PERF === '1';

export default {
  format: reportsEnabled
    ? ['progress-bar', 'html:reports/cucumber-report.html', 'json:reports/cucumber-report.json']
    : ['progress-bar'],
  formatOptions: {
    snippetInterface: 'async-await',
  },
  // Perf samples run one at a time so parallel workers do not steal CPU from the measurement.
  parallel: canRunInParallel && !perfRun ? Math.max(1, requestedParallel) : 1,
  paths: ['src/features/**/*.feature'],
  publishQuiet: true,
  require: ['src/steps/**/!(*.test).ts', 'src/support/**/*.ts'],
  requireModule: ['tsx/cjs'],
  retry: 0,
  tags: perfRun ? '@perf and not @skip' : 'not @skip and not @perf',
  timeout: 30_000,
};
