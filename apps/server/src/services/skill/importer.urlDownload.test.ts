// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillImporter } from './importer';

const mocks = vi.hoisted(() => ({
  parseSkillMd: vi.fn(),
  ssrfSafeFetch: vi.fn(),
}));
vi.mock('@/database/models/agentSkill', () => ({ AgentSkillModel: class {} }));
vi.mock('@/server/modules/GitHub', () => ({
  GitHub: class {},
  GitHubNotFoundError: class extends Error {},
  GitHubParseError: class extends Error {},
}));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('./resource', () => ({ SkillResourceService: class {} }));
vi.mock('./parser', () => ({
  SkillParser: class {
    parseSkillMd = mocks.parseSkillMd;
  },
}));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: mocks.ssrfSafeFetch }));

const url = 'https://example.com/skills/slow/SKILL.md';
const importer = () => new SkillImporter({} as LobeChatDatabase, 'owner', 'scope');

/**
 * Like ssrfSafeFetch: resolves at the headers and streams a body that only the caller's
 * signal can end. This one never finishes on its own.
 */
const respondWithStalledBody = (_url: string, init: RequestInit) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('---\nname: Slow\n'));
        init.signal!.addEventListener('abort', () =>
          controller.error(new Error('Fetch failed: The operation was aborted.')),
        );
      },
    }),
    { headers: { 'content-type': 'text/markdown' } },
  );

describe('SkillImporter URL download', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.ssrfSafeFetch.mockImplementation(respondWithStalledBody);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('applies the 30s download timeout to the body, not just the headers', async () => {
    const outcome = importer()
      .importFromUrl({ url })
      .then(
        () => 'resolved',
        (error) => error,
      );

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(Promise.race([outcome, Promise.resolve('still pending')])).resolves.toMatchObject({
      code: 'DOWNLOAD_FAILED',
      message: expect.stringContaining('aborted'),
    });
    expect(mocks.parseSkillMd).not.toHaveBeenCalled();
  });

  it.each([404, 500])('releases the unread body of a %d response', async (status) => {
    const cancel = vi.fn();
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(new ReadableStream({ cancel, pull: () => new Promise(() => {}) }), { status }),
    );

    await expect(importer().importFromUrl({ url })).rejects.toMatchObject({
      code: status === 404 ? 'NOT_FOUND' : 'DOWNLOAD_FAILED',
    });
    expect(cancel).toHaveBeenCalled();
  });
});
