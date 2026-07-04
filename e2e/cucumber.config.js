/**
 * @type {import('@cucumber/cucumber').IConfiguration}
 */
const reportsEnabled = !['0', 'false'].includes(String(process.env.E2E_REPORTS).toLowerCase());
const parsedParallel = Number(process.env.E2E_PARALLEL || process.env.CUCUMBER_PARALLEL || 1);
const requestedParallel = Number.isFinite(parsedParallel) ? parsedParallel : 1;
const canRunInParallel = Boolean(process.env.BASE_URL);

export default {
  format: reportsEnabled
    ? ['progress-bar', 'html:reports/cucumber-report.html', 'json:reports/cucumber-report.json']
    : ['progress-bar'],
  formatOptions: {
    snippetInterface: 'async-await',
  },
  parallel: canRunInParallel ? Math.max(1, requestedParallel) : 1,
  paths: ['src/features/**/*.feature'],
  publishQuiet: true,
  require: ['src/steps/**/*.ts', 'src/support/**/*.ts'],
  requireModule: ['tsx/cjs'],
  retry: 0,
  tags: 'not @skip',
  timeout: 30_000,
};
