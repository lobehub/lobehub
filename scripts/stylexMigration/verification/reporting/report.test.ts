// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { sha256, writeArtifactManifest, writeHtmlReport, writeJson } from './report';

const owned: string[] = [];
const output = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'stylex-report-test-'));
  owned.push(directory);
  return directory;
};
afterEach(async () => {
  for (const directory of owned.splice(0)) await rm(directory, { force: true, recursive: true });
});

describe('local evidence reports', () => {
  it('treats component text as data, not executable HTML', async () => {
    const directory = await output();
    await writeHtmlReport(directory, { text: '</pre><script>alert(1)</script>' });
    const html = await readFile(path.join(directory, 'report.html'), 'utf8');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain("default-src 'none'");
  });
  it('refuses traversal and overwrites, and hashes the exact evidence bytes', async () => {
    const directory = await output();
    await expect(writeJson(directory, '../escape.json', {})).rejects.toThrow(
      'UNSAFE_ARTIFACT_PATH',
    );
    await writeJson(directory, 'scope.json', { units: 2 });
    await expect(writeJson(directory, 'scope.json', {})).rejects.toThrow();
    const bytes = await readFile(path.join(directory, 'scope.json'));
    expect(await writeArtifactManifest(directory, ['scope.json'])).toEqual([
      { bytes: bytes.length, path: 'scope.json', sha256: sha256(bytes) },
    ]);
  });
});
