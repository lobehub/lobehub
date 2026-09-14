// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const launcher = path.resolve(import.meta.dirname, './start.mts');
const tsxCli = path.resolve(repositoryRoot, 'node_modules/tsx/dist/cli.mjs');

describe('page collaboration ESM launcher', () => {
  it('runs the configured entry through a native ESM bundle preflight', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.['dev:page-collaboration']).toBe(
      'tsx scripts/page-collaboration/start.mts',
    );

    const output = execFileSync(process.execPath, [tsxCli, launcher, '--preflight'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: process.env,
      timeout: 30_000,
    });

    expect(output).toContain('[page-collaboration] ESM composition preflight passed');
    expect(output).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
  }, 30_000);

  it('keeps the snapshot seed command on the same ESM boundary', () => {
    const output = execFileSync(process.execPath, [tsxCli, launcher, '--seed', '--', '--help'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: process.env,
      timeout: 30_000,
    });

    expect(output).toContain('Usage:');
    expect(output).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
  }, 30_000);

  it('loads a cwd .env before importing the bundled database graph', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'page-collaboration-env-order-'));
    const runtimeRoot = path.join(repositoryRoot, 'dist/page-collaboration');
    const runtimeEntries = () =>
      existsSync(runtimeRoot)
        ? readdirSync(runtimeRoot)
            .filter((entry) => /^(?:relay|seed)-\d+-/.test(entry))
            .sort()
        : [];
    const before = runtimeEntries();

    writeFileSync(
      path.join(cwd, '.env'),
      [
        'DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET=env-sentinel',
        'DOCUMENT_REWRITE_TICKET_SECRET=env-sentinel',
        'AUTH_SECRET=env-sentinel',
        'KEY_VAULTS_SECRET=env-sentinel',
        'DATABASE_DRIVER=node',
        'DATABASE_URL=postgres://127.0.0.1:1/lobehub',
        'PAGE_COLLABORATION_PORT=0',
      ].join('\n'),
    );

    const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development' };
    for (const key of [
      'AUTH_SECRET',
      'DATABASE_DRIVER',
      'DATABASE_URL',
      'DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET',
      'DOCUMENT_REWRITE_TICKET_SECRET',
      'KEY_VAULTS_SECRET',
      'PAGE_COLLABORATION_BACKEND',
      'PAGE_COLLABORATION_HOST',
      'PAGE_COLLABORATION_PORT',
      'REDIS_PREFIX',
      'REDIS_URL',
    ]) {
      delete environment[key];
    }
    environment.NODE_ENV = 'development';

    try {
      const result = spawnSync(process.execPath, [tsxCli, launcher], {
        cwd,
        encoding: 'utf8',
        env: environment,
        timeout: 30_000,
      });
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

      expect(result.status).toBe(1);
      expect(output).toContain('ECONNREFUSED 127.0.0.1:1');
      expect(output).not.toContain('KEY_VAULTS_SECRET` is not set');
      expect(output).not.toContain('DATABASE_URL" is not set correctly');
      expect(output).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
      expect(runtimeEntries()).toEqual(before);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  }, 30_000);
});
