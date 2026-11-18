import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCacheScope } from '@/libs/swr/useCacheScope';
import { ragService } from '@/services/rag';

import { KnowledgeFileHydration } from './knowledgeFileHydration';

vi.mock('@/libs/swr/useCacheScope', () => ({ getCacheScope: vi.fn() }));
vi.mock('@/services/rag', () => ({ ragService: { parseFileContent: vi.fn() } }));

const parse = vi.mocked(ragService.parseFileContent);
type Document = Awaited<ReturnType<typeof ragService.parseFileContent>>;
const failed = 'The file is attached but its contents could not be extracted.';
const processing =
  'The file is attached but is still being processed; its contents are not available for this message.';

describe('knowledge file hydration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getCacheScope).mockReturnValue('workspace-a');
    parse.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('releases sends after five seconds while a single parse warms the cache', async () => {
    const cache = vi.fn();
    const hydration = new KnowledgeFileHydration(cache);
    const parseResult = Promise.withResolvers<Document>();
    parse.mockReturnValue(parseResult.promise);

    const first = hydration.hydrate('agent-a', ['file']);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(vi.getTimerCount()).toBe(1);
    expect(cache).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(first).resolves.toEqual(new Map([['file', processing]]));

    const second = hydration.hydrate('agent-b', ['file']);
    expect(parse).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(second).resolves.toEqual(new Map([['file', processing]]));
    expect(vi.getTimerCount()).toBe(0);

    parseResult.resolve({ content: 'late text' } as Document);
    await vi.advanceTimersByTimeAsync(0);
    expect(cache).toHaveBeenCalledExactlyOnceWith(
      new Set(['agent-a', 'agent-b']),
      'file',
      'late text',
    );
  });

  it.each(['BAD_REQUEST', 'FORBIDDEN', 'UNAUTHORIZED'] as const)(
    'caches a late %s failure and retries only a transient failure',
    async (code) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const parseResult = Promise.withResolvers<Document>();
      parse
        .mockReturnValueOnce(parseResult.promise)
        .mockResolvedValue({ content: 'retry' } as Document);
      const cache = vi.fn();
      const hydration = new KnowledgeFileHydration(cache);

      const first = hydration.hydrate('agent-a', ['file']);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(first).resolves.toEqual(new Map([['file', processing]]));

      parseResult.reject({ data: { code } });
      await vi.advanceTimersByTimeAsync(0);
      expect(error).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(299_999);
      await expect(hydration.hydrate('agent-a', ['file'])).resolves.toEqual(
        new Map([['file', failed]]),
      );
      expect(parse).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      if (code === 'BAD_REQUEST') {
        await expect(hydration.hydrate('agent-a', ['file'])).resolves.toEqual(new Map());
        expect(parse).toHaveBeenCalledTimes(2);
        expect(cache).toHaveBeenCalledExactlyOnceWith(new Set(['agent-a']), 'file', 'retry');
      } else {
        await expect(hydration.hydrate('agent-a', ['file'])).resolves.toEqual(
          new Map([['file', failed]]),
        );
        expect(parse).toHaveBeenCalledTimes(1);
      }
      expect(error).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves a denial when switching away from a workspace and back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    parse
      .mockRejectedValueOnce({ data: { code: 'FORBIDDEN' } })
      .mockResolvedValue({ content: 'other workspace' } as Document);
    const hydration = new KnowledgeFileHydration(vi.fn());
    await expect(hydration.hydrate('agent-a', ['file'])).resolves.toEqual(
      new Map([['file', failed]]),
    );

    vi.mocked(getCacheScope).mockReturnValue('workspace-b');
    await expect(hydration.hydrate('agent-b', ['file'])).resolves.toEqual(new Map());
    vi.mocked(getCacheScope).mockReturnValue('workspace-a');
    await expect(hydration.hydrate('agent-a', ['file'])).resolves.toEqual(
      new Map([['file', failed]]),
    );
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('does not write an old scope result into the current scope', async () => {
    const cache = vi.fn();
    const hydration = new KnowledgeFileHydration(cache);
    const oldParse = Promise.withResolvers<Document>();
    parse
      .mockReturnValueOnce(oldParse.promise)
      .mockResolvedValue({ content: 'current' } as Document);
    const oldSend = hydration.hydrate('agent-a', ['file']);

    vi.mocked(getCacheScope).mockReturnValue('workspace-b');
    expect(await hydration.hydrate('agent-a', ['file'])).toEqual(new Map());
    oldParse.resolve({ content: 'old' } as Document);
    await expect(oldSend).resolves.toEqual(new Map());
    expect(cache).toHaveBeenCalledExactlyOnceWith(new Set(['agent-a']), 'file', 'current');
  });
});
