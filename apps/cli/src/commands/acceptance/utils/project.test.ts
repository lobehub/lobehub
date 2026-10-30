import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findDeclaredProject } from './project';

describe('findDeclaredProject', () => {
  let root: string;

  const adapter = (repo: string, config?: string) => {
    const dir = path.join(root, repo, '.agents', 'acceptance');
    mkdirSync(dir, { recursive: true });
    if (config !== undefined) writeFileSync(path.join(dir, 'config.json'), config);
    return dir;
  };
  const dir = (...segments: string[]) => {
    const target = path.join(root, ...segments);
    mkdirSync(target, { recursive: true });
    return target;
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'lh-acceptance-project-'));
  });
  afterEach(() => rmSync(root, { force: true, recursive: true }));

  it('reads the project from the nearest repository above the start directory', () => {
    const configDir = adapter('repo', '{ "project": " LOBE " }');

    expect(findDeclaredProject([dir('repo', '.acceptances', 'topic-1', 'round')])).toEqual({
      file: path.join(configDir, 'config.json'),
      kind: 'declared',
      project: 'LOBE',
    });
  });

  it("stops at a nested repository's adapter instead of inheriting its parent's project", () => {
    adapter('repo', '{ "project": "CLOUD" }');
    adapter(path.join('repo', 'lobehub'));

    expect(findDeclaredProject([dir('repo', 'lobehub', 'src')])).toBeUndefined();
  });

  it('falls back to the next start directory only when the first is outside any repository', () => {
    adapter('repo', '{ "project": "LOBE" }');

    expect(findDeclaredProject([dir('scratch', 'round'), dir('repo', 'src')])).toEqual(
      expect.objectContaining({ project: 'LOBE' }),
    );
  });

  it('declares nothing when the config has no project', () => {
    adapter('repo', '{}');

    expect(findDeclaredProject([dir('repo')])).toBeUndefined();
  });

  it.each([
    ['{ "project": ', 'not valid JSON'],
    ['["LOBE"]', 'expected a JSON object'],
    ['{ "project": 42 }', '"project" must be a non-empty string'],
    ['{ "project": "  " }', '"project" must be a non-empty string'],
  ])('reports %s as invalid', (config, reason) => {
    adapter('repo', config);

    expect(findDeclaredProject([dir('repo')])).toEqual(
      expect.objectContaining({ kind: 'invalid', reason }),
    );
  });
});
