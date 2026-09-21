import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAcceptanceSkillBundle } from './index';

const commit = 'a'.repeat(40);
const content = '---\nname: acceptance\nmetadata:\n  version: "0.5.0"\n---\n# Acceptance';
const resources = {
  'LICENSE': 'Apache-2.0',
  'references/report.md': '\uFEFF# Reports',
  'scripts/nested/capture.cjs': 'capture();',
};

function archive(
  sha = commit,
  files: Record<string, string> = { 'SKILL.md': content, ...resources },
) {
  const root = `acceptance-${sha}`;
  const data = zipSync({
    [`${root}/README.md`]: strToU8('Not a skill resource'),
    ...Object.fromEntries(
      Object.entries(files).map(([file, text]) => [
        `${root}/skills/acceptance/${file}`,
        strToU8(text),
      ]),
    ),
  });
  return new Response(new Uint8Array(data).buffer);
}

function mockSource(sha = commit, files?: Record<string, string>) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ sha }))
    .mockResolvedValueOnce(archive(sha, files));
}

afterEach(() => vi.restoreAllMocks());

describe('fetchAcceptanceSkillBundle', () => {
  it('downloads the default branch snapshot with every skill resource from one commit', async () => {
    const fetchSpy = mockSource();
    expect(await fetchAcceptanceSkillBundle()).toEqual({
      content,
      files: resources,
      identifier: 'acceptance',
      name: 'acceptance',
      source: {
        commit,
        path: 'skills/acceptance',
        ref: 'HEAD',
        repository: 'lobehub/acceptance',
      },
      version: '0.5.0',
    });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/lobehub/acceptance/commits/HEAD',
      `https://codeload.github.com/lobehub/acceptance/zip/${commit}`,
    ]);
  });

  it('takes a new default-branch commit even when the declared skill version is unchanged', async () => {
    const next = 'b'.repeat(40);
    const fetchSpy = mockSource();
    const first = await fetchAcceptanceSkillBundle();
    fetchSpy
      .mockResolvedValueOnce(Response.json({ sha: next }))
      .mockResolvedValueOnce(archive(next, { 'SKILL.md': content, 'new.md': 'unreleased change' }));

    const second = await fetchAcceptanceSkillBundle();
    expect(second.version).toBe(first.version);
    expect(second.source.commit).toBe(next);
    expect(second.files).toEqual({ 'new.md': 'unreleased change' });
  });

  it('allows a development version on the default branch without a stable release', async () => {
    mockSource(commit, { 'SKILL.md': content.replace('0.5.0', '0.6.0-dev.1') });
    expect((await fetchAcceptanceSkillBundle()).version).toBe('0.6.0-dev.1');
  });

  it.each(['0.5.0', 'v0.5.0'])('can select a tag explicitly (%s)', async (version) => {
    const fetchSpy = mockSource();
    const bundle = await fetchAcceptanceSkillBundle(version);
    expect(bundle.source).toMatchObject({ commit, ref: 'v0.5.0' });
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/lobehub/acceptance/commits/v0.5.0',
    );
  });

  it('reports failed source resolution without requesting an archive or release', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Unavailable', { status: 503 }));
    await expect(fetchAcceptanceSkillBundle()).rejects.toThrow('503');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reports archive download failures', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ sha: commit }))
      .mockResolvedValueOnce(new Response('Unavailable', { status: 404 }));
    await expect(fetchAcceptanceSkillBundle()).rejects.toThrow('404');
  });

  it.each(['../outside', '/outside', 'C:/outside', 'references/../../outside', 'a\\b', 'skill.md'])(
    'rejects an unsafe resource path: %s',
    async (file) => {
      mockSource(commit, { 'SKILL.md': content, [file]: 'unsafe' });
      await expect(fetchAcceptanceSkillBundle()).rejects.toThrow('relative paths');
    },
  );

  it('rejects missing skill content and mismatched tag versions', async () => {
    const fetchSpy = mockSource(commit, { 'other.md': '# Other' });
    await expect(fetchAcceptanceSkillBundle()).rejects.toThrow('SKILL.md');
    fetchSpy.mockResolvedValueOnce(Response.json({ sha: commit })).mockResolvedValueOnce(archive());
    await expect(fetchAcceptanceSkillBundle('0.6.0')).rejects.toThrow('requested version');
  });

  it('rejects a malformed commit response before downloading an archive', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ sha: 'HEAD' }));
    await expect(fetchAcceptanceSkillBundle()).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects non-version values before requesting a tag', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchAcceptanceSkillBundle('master')).rejects.toThrow('version');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
