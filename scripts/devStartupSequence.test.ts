/**
 * @vitest-environment node
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getWorkspaceDependencyIssue } from './devStartupSequence.mts';

const makeTempDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const cleanup = (dir: string) => fs.rmSync(dir, { force: true, recursive: true });

describe('devStartupSequence', () => {
  /**
   * Cloud starts this script with bare `node` (native type stripping), which does not map a
   * `.mjs` specifier to its `.mts` source the way `tsx` and Vitest do. Load it in a real Node
   * process so a relative import that only those tools can resolve fails here instead of breaking
   * Cloud `bun run dev` with ERR_MODULE_NOT_FOUND.
   */
  it('resolves every import under bare node', () => {
    const entry = pathToFileURL(path.resolve(__dirname, 'devStartupSequence.mts')).href;
    const result = spawnSync(
      'node',
      ['--input-type=module', '-e', `await import(${JSON.stringify(entry)});`],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.status).toBe(0);
  });

  describe('getWorkspaceDependencyIssue', () => {
    it('accepts node_modules installed inside the worktree', () => {
      const projectRoot = makeTempDir('lobehub-dev-preflight-local-');
      try {
        fs.mkdirSync(path.join(projectRoot, 'node_modules'));
        expect(getWorkspaceDependencyIssue(projectRoot)).toBeUndefined();
      } finally {
        cleanup(projectRoot);
      }
    });

    it('reports a missing node_modules instead of letting Next panic', () => {
      const projectRoot = makeTempDir('lobehub-dev-preflight-missing-');
      try {
        expect(getWorkspaceDependencyIssue(projectRoot)).toContain('node_modules is missing');
      } finally {
        cleanup(projectRoot);
      }
    });

    it('rejects node_modules linked outside the worktree', () => {
      const projectRoot = makeTempDir('lobehub-dev-preflight-project-');
      const externalRoot = makeTempDir('lobehub-dev-preflight-external-');
      try {
        const externalNodeModules = path.join(externalRoot, 'node_modules');
        fs.mkdirSync(externalNodeModules);
        fs.symlinkSync(externalNodeModules, path.join(projectRoot, 'node_modules'), 'junction');

        expect(getWorkspaceDependencyIssue(projectRoot)).toContain('outside the worktree');
      } finally {
        cleanup(projectRoot);
        cleanup(externalRoot);
      }
    });
  });
});
