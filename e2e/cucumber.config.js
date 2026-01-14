/**
 * @type {import('@cucumber/cucumber').IConfiguration}
 */
export default {
  format: [
    'progress-bar',
    'html:reports/cucumber-report.html',
    'json:reports/cucumber-report.json',
  ],
  formatOptions: {
    snippetInterface: 'async-await',
  },
  parallel: 1,
  paths: ['src/features/**/*.feature'],
  publishQuiet: true,
  require: ['src/steps/**/*.ts', 'src/support/**/*.ts'],
  requireModule: ['tsx/cjs'],
  retry: 0,
  tags: 'not @skip',
  timeout: 30_000,
};
