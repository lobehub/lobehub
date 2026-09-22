import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { fetchAcceptanceSkillBundle as fetchBundle } from './index';

let fetchAcceptanceSkillBundle: typeof fetchBundle;

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

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('GITHUB_TOKEN', '');
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
  ({ fetchAcceptanceSkillBundle } = await import('./index'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

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
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
  });

  it('sends the server token only to the commits API, not to codeload or the bundle', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'server-test-token');
    const fetchSpy = mockSource();

    const bundle = await fetchAcceptanceSkillBundle();

    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      'Bearer server-test-token',
    );
    expect(new Headers(fetchSpy.mock.calls[1][1]?.headers).has('Authorization')).toBe(false);
    expect(JSON.stringify(bundle)).not.toContain('server-test-token');
  });

  it('checks HEAD again but reuses the validated snapshot when its SHA is unchanged', async () => {
    const fetchSpy = mockSource();
    const first = await fetchAcceptanceSkillBundle();
    fetchSpy.mockResolvedValueOnce(Response.json({ sha: commit }));

    expect(await fetchAcceptanceSkillBundle()).toEqual(first);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/lobehub/acceptance/commits/HEAD',
      `https://codeload.github.com/lobehub/acceptance/zip/${commit}`,
      'https://api.github.com/repos/lobehub/acceptance/commits/HEAD',
    ]);
  });

  it('shares an in-flight archive download without sharing ref resolution or response metadata', async () => {
    const gate = Promise.withResolvers<void>();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).startsWith('https://api.github.com/')) return Response.json({ sha: commit });
      await gate.promise;
      return archive();
    });

    const first = fetchAcceptanceSkillBundle();
    const second = fetchAcceptanceSkillBundle('0.5.0');
    await vi.waitFor(() => {
      expect(
        fetchSpy.mock.calls.filter(([url]) => String(url).includes('codeload')),
      ).not.toHaveLength(0);
    });
    gate.resolve();
    const [head, tag] = await Promise.all([first, second]);

    expect(head.source).toMatchObject({ commit, ref: 'HEAD' });
    expect(tag.source).toMatchObject({ commit, ref: 'v0.5.0' });
    expect(head.files).toEqual(resources);
    expect(tag.files).toEqual(resources);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/lobehub/acceptance/commits/HEAD',
      'https://api.github.com/repos/lobehub/acceptance/commits/v0.5.0',
      `https://codeload.github.com/lobehub/acceptance/zip/${commit}`,
    ]);
  });

  it('validates the requested tag even when HEAD already cached the same commit', async () => {
    const fetchSpy = mockSource();
    await fetchAcceptanceSkillBundle();
    fetchSpy.mockResolvedValueOnce(Response.json({ sha: commit }));

    await expect(fetchAcceptanceSkillBundle('0.6.0')).rejects.toThrow('requested version');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('never returns a cached snapshot when the fresh HEAD lookup fails', async () => {
    const fetchSpy = mockSource();
    await fetchAcceptanceSkillBundle();
    fetchSpy.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));

    await expect(fetchAcceptanceSkillBundle()).rejects.toThrow('503');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('bounds the snapshot cache to eight commits', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (let index = 1; index <= 9; index++) {
      const sha = index.toString(16).padStart(40, '0');
      fetchSpy.mockResolvedValueOnce(Response.json({ sha })).mockResolvedValueOnce(archive(sha));
      expect((await fetchAcceptanceSkillBundle()).source.commit).toBe(sha);
    }
    const last = '9'.padStart(40, '0');
    fetchSpy.mockResolvedValueOnce(Response.json({ sha: last }));
    expect((await fetchAcceptanceSkillBundle()).source.commit).toBe(last);

    const first = '1'.padStart(40, '0');
    fetchSpy
      .mockResolvedValueOnce(Response.json({ sha: first }))
      .mockResolvedValueOnce(archive(first));
    expect((await fetchAcceptanceSkillBundle()).source.commit).toBe(first);
    expect(fetchSpy).toHaveBeenCalledTimes(21);
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

  it('resolves a newer HEAD even while the preceding HEAD snapshot is still downloading', async () => {
    const next = 'b'.repeat(40);
    const gate = Promise.withResolvers<void>();
    let resolutions = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('api.github.com')) {
        return Response.json({ sha: resolutions++ === 0 ? commit : next });
      }
      if (String(url).endsWith(commit)) {
        await gate.promise;
        return archive();
      }
      return archive(next, { 'SKILL.md': content, 'new.md': 'new HEAD' });
    });
    const first = fetchAcceptanceSkillBundle();
    try {
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      const second = await fetchAcceptanceSkillBundle();
      expect(second.source.commit).toBe(next);
      expect(second.files).toEqual({ 'new.md': 'new HEAD' });
    } finally {
      gate.resolve();
    }
    expect((await first).source.commit).toBe(commit);
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

  it.each(['download', 'validation'])('does not cache a failed %s', async (failure) => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ sha: commit }))
      .mockResolvedValueOnce(
        failure === 'download'
          ? new Response('Unavailable', { status: 503 })
          : archive(commit, { 'SKILL.md': content, '../outside': 'unsafe' }),
      );
    await expect(fetchAcceptanceSkillBundle()).rejects.toThrow();
    fetchSpy.mockResolvedValueOnce(Response.json({ sha: commit })).mockResolvedValueOnce(archive());

    expect((await fetchAcceptanceSkillBundle()).files).toEqual(resources);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it.each<{ body: string; headers: HeadersInit; message: string; status: number }>([
    {
      body: 'API rate limit exceeded',
      headers: {
        'retry-after': '45',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '2000000000',
      },
      message: 'Retry after 45 seconds.',
      status: 403,
    },
    {
      body: 'API rate limit exceeded',
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000000000' },
      message: 'Retry after 2033-05-18T03:33:20.000Z.',
      status: 403,
    },
    {
      body: 'You have exceeded a secondary rate limit',
      headers: {},
      message: 'Retry after at least 60 seconds.',
      status: 403,
    },
    {
      body: 'Too many requests',
      headers: {},
      message: 'Retry after at least 60 seconds.',
      status: 429,
    },
    {
      body: 'Too many requests',
      headers: { 'retry-after': 'Wed, 18 May 2033 03:33:20 GMT' },
      message: 'Retry after Wed, 18 May 2033 03:33:20 GMT.',
      status: 429,
    },
  ])(
    'reports a rate limit with $message without retrying',
    async ({ body, headers, message, status }) => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(body, { headers, status }));

      await expect(fetchAcceptanceSkillBundle()).rejects.toThrow(
        `GitHub rate limit exceeded (${status}). ${message}`,
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it('does not label a permission-denied 403 as rate limiting', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Forbidden', { status: 403 }));

    await expect(fetchAcceptanceSkillBundle()).rejects.toThrow(
      'Unable to download the acceptance skill (403)',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
