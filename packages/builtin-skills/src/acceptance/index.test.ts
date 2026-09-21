import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAcceptanceSkillBundle } from './index';

const bundle = {
  content: '---\nname: acceptance\nmetadata:\n  version: "0.5.0"\n---\n# Acceptance',
  files: { 'references/report.md': '# Reports', 'scripts/capture.cjs': 'capture();' },
  identifier: 'acceptance',
  name: 'acceptance',
  source: {
    commit: 'a'.repeat(40),
    path: 'skills/acceptance',
    repository: 'lobehub/acceptance',
    tag: 'v0.5.0',
  },
  version: '0.5.0',
};

afterEach(() => vi.restoreAllMocks());

describe('fetchAcceptanceSkillBundle', () => {
  it.each([undefined, '0.5.0', 'v0.5.0'])('downloads a complete release (%s)', async (version) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(bundle));
    expect(await fetchAcceptanceSkillBundle(version)).toEqual(bundle);
    const release = version ? 'download/v0.5.0' : 'latest/download';
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `https://github.com/lobehub/acceptance/releases/${release}/acceptance-skill.json`,
    );
  });

  it('reports failed downloads instead of falling back to an old bundled copy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unavailable', { status: 503 }));
    await expect(fetchAcceptanceSkillBundle()).rejects.toThrow('503');
  });

  it.each(['../outside', '/outside', 'C:/outside', 'references/../../outside', 'a\\b', 'SKILL.md'])(
    'rejects an unsafe resource path: %s',
    async (file) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({ ...bundle, files: { [file]: 'unsafe' } }),
      );
      await expect(fetchAcceptanceSkillBundle()).rejects.toThrow('relative paths');
    },
  );

  it('rejects inconsistent release metadata and pinned-version mismatches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(bundle));
    await expect(fetchAcceptanceSkillBundle('0.6.0')).rejects.toThrow('version does not match');
    fetchSpy.mockResolvedValueOnce(Response.json({ ...bundle, version: '0.6.0' }));
    await expect(fetchAcceptanceSkillBundle()).rejects.toThrow('version does not match');
  });

  it('rejects malformed bundles and non-release refs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ files: {} }));
    await expect(fetchAcceptanceSkillBundle()).rejects.toThrow();
    vi.mocked(fetch).mockClear();
    await expect(fetchAcceptanceSkillBundle('master')).rejects.toThrow('stable version');
    expect(fetch).not.toHaveBeenCalled();
  });
});
