#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const e2eRoot = path.join(root, 'e2e');
const reports = path.join(e2eRoot, 'reports');
const heyangReports = path.join(e2eRoot, 'heyang', 'reports');

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    ...options,
  });

run(process.execPath, [path.join(root, 'scripts', 'heyang', 'preflight-check.sh')]);

fs.mkdirSync(reports, { recursive: true });
fs.mkdirSync(heyangReports, { recursive: true });

const cucumberBin = path.join(e2eRoot, 'node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js');

const env = {
  ...process.env,
  BASE_URL: process.env.BASE_URL || 'http://localhost:3010',
  HEADLESS: process.env.HEADLESS || 'true',
};
const featureGlob = process.env.HEYANG_E2E_FEATURES || 'heyang/features/**/*.feature';
const tags = process.env.HEYANG_E2E_TAGS || '@smoke and not @real-llm';

run(
  process.execPath,
  [
    cucumberBin,
    featureGlob,
    '--require-module',
    'tsx/cjs',
    '--require',
    'heyang/support/**/*.ts',
    '--require',
    'heyang/steps/**/*.ts',
    '--tags',
    tags,
    '--format',
    'progress',
    '--format',
    'json:reports/heyang-cucumber-report.json',
    '--format',
    'html:reports/heyang-cucumber-report.html',
    '--format',
    'json:heyang/reports/latest.json',
    '--format',
    'html:heyang/reports/latest.html',
  ],
  { cwd: e2eRoot, env },
);
