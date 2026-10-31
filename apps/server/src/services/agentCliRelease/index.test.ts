// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AgentCliReleaseService } from '.';

const PACKAGE = '@anthropic-ai/claude-code';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const createService = (fetch: ReturnType<typeof vi.fn>) => {
  let now = 0;
  const service = new AgentCliReleaseService({ fetch: fetch as any, now: () => now });
  return {
    advance: (ms: number) => {
      now += ms;
    },
    service,
  };
};

describe('AgentCliReleaseService', () => {
  it('reads the latest dist-tag of the package from the npm registry', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ version: '2.1.316' }));
    const { service } = createService(fetch);

    await expect(service.getLatestVersion(PACKAGE)).resolves.toBe('2.1.316');
    expect(fetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@anthropic-ai/claude-code/latest',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  it('shares one lookup between callers until it expires', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ version: '2.1.316' }))
      .mockResolvedValueOnce(jsonResponse({ version: '2.1.317' }));
    const { advance, service } = createService(fetch);

    const [first, second] = await Promise.all([
      service.getLatestVersion(PACKAGE),
      service.getLatestVersion(PACKAGE),
    ]);
    expect([first, second]).toEqual(['2.1.316', '2.1.316']);
    expect(fetch).toHaveBeenCalledTimes(1);

    advance(59 * 60_000);
    await expect(service.getLatestVersion(PACKAGE)).resolves.toBe('2.1.316');
    expect(fetch).toHaveBeenCalledTimes(1);

    advance(2 * 60_000);
    await expect(service.getLatestVersion(PACKAGE)).resolves.toBe('2.1.317');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports no version when the registry fails, and retries sooner', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse({ version: '2.1.316' }));
    const { advance, service } = createService(fetch);

    await expect(service.getLatestVersion(PACKAGE)).resolves.toBeNull();

    advance(6 * 60_000);
    await expect(service.getLatestVersion(PACKAGE)).resolves.toBe('2.1.316');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports no version when the network is unreachable', async () => {
    const { service } = createService(vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(service.getLatestVersion(PACKAGE)).resolves.toBeNull();
  });

  it('ignores a response without a valid semver version', async () => {
    const { service } = createService(vi.fn().mockResolvedValue(jsonResponse({ version: 'next' })));

    await expect(service.getLatestVersion(PACKAGE)).resolves.toBeNull();
  });
});
