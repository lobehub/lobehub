import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeArgs } from './collect';
import { setConfig } from './paths';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'check-collect-'));
  mkdirSync(path.join(root, 'lobehub/.agents/skills/design/scripts'), { recursive: true });
  writeFileSync(path.join(root, 'lobehub/.agents/skills/design/scripts/run.mjs'), '');
  mkdirSync(path.join(root, '.agents/skills'), { recursive: true });
  symlinkSync('../../lobehub/.agents/skills/design', path.join(root, '.agents/skills/design'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src/app.ts'), '');
  // A link that leaves the repo, like a skill installed from the user's home.
  const outside = mkdtempSync(path.join(tmpdir(), 'check-outside-'));
  symlinkSync(outside, path.join(root, '.agents/skills/external'));

  setConfig({
    repos: [
      { dir: '', pipelines: [] },
      { dir: 'lobehub', pipelines: [] },
    ],
    rootDir: root,
  });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('normalizeArgs', () => {
  it('routes a host path that links into a sub-repo to its real sub-repo path', () => {
    expect(normalizeArgs([path.join(root, '.agents/skills/design/scripts/run.mjs')])).toEqual([
      'lobehub/.agents/skills/design/scripts/run.mjs',
    ]);
  });

  it('checks a file once when both its link path and its real path are passed', () => {
    expect(
      normalizeArgs([
        path.join(root, '.agents/skills/design/scripts/run.mjs'),
        path.join(root, 'lobehub/.agents/skills/design/scripts/run.mjs'),
      ]),
    ).toEqual(['lobehub/.agents/skills/design/scripts/run.mjs']);
  });

  it('resolves the linked directory of a deleted file', () => {
    expect(normalizeArgs([path.join(root, '.agents/skills/design/scripts/gone.mjs')])).toEqual([
      'lobehub/.agents/skills/design/scripts/gone.mjs',
    ]);
  });

  it('keeps plain host paths and links that leave the repo as written', () => {
    expect(
      normalizeArgs([
        path.join(root, 'src/app.ts'),
        path.join(root, '.agents/skills/external/SKILL.md'),
      ]),
    ).toEqual(['src/app.ts', '.agents/skills/external/SKILL.md']);
  });
});
