// @vitest-environment node
import type { ScopedMutator } from 'swr/_internal';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate, setScopedMutate } from './mutate';

const { getActiveWorkspaceIdMock } = vi.hoisted(() => ({
  getActiveWorkspaceIdMock: vi.fn<() => string | null>(),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: getActiveWorkspaceIdMock,
  useActiveWorkspaceId: getActiveWorkspaceIdMock,
}));

const scopedMutateMock = vi.fn() as unknown as ScopedMutator & ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  getActiveWorkspaceIdMock.mockReturnValue(null);
  (scopedMutateMock as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  setScopedMutate(scopedMutateMock);
});

describe('scoped mutate', () => {
  it('passes string keys through unchanged in personal mode', async () => {
    getActiveWorkspaceIdMock.mockReturnValue(null);

    await mutate('image:generationTopics');

    expect(scopedMutateMock).toHaveBeenCalledWith('image:generationTopics');
  });

  it('passes array keys through unchanged in personal mode', async () => {
    getActiveWorkspaceIdMock.mockReturnValue(null);

    await mutate(['image:generationBatches', 'topic-1']);

    expect(scopedMutateMock).toHaveBeenCalledWith(['image:generationBatches', 'topic-1']);
  });

  it('appends workspace id to array keys in workspace mode', async () => {
    getActiveWorkspaceIdMock.mockReturnValue('ws-1');

    await mutate(['image:generationBatches', 'topic-1']);

    // Mirrors the augmentKey used by useClientDataSWR — keys must stay
    // symmetric so the mutate actually matches the live subscriber.
    expect(scopedMutateMock).toHaveBeenCalledWith(['image:generationBatches', 'topic-1', 'ws-1']);
  });

  it('wraps non-array keys into a tuple with workspace id in workspace mode', async () => {
    getActiveWorkspaceIdMock.mockReturnValue('ws-1');

    await mutate('image:generationTopics');

    expect(scopedMutateMock).toHaveBeenCalledWith(['image:generationTopics', 'ws-1']);
  });

  it('passes function-form matcher keys through unchanged in workspace mode', async () => {
    getActiveWorkspaceIdMock.mockReturnValue('ws-1');
    const matcher = (key: unknown) => Array.isArray(key) && key[0] === 'image:generationTopics';

    await mutate(matcher);

    expect(scopedMutateMock).toHaveBeenCalledWith(matcher);
  });

  it('forwards extra arguments (data + options) to the underlying mutator', async () => {
    getActiveWorkspaceIdMock.mockReturnValue('ws-1');

    await mutate(['image:generationTopics'], { foo: 'bar' }, { revalidate: true });

    expect(scopedMutateMock).toHaveBeenCalledWith(
      ['image:generationTopics', 'ws-1'],
      { foo: 'bar' },
      { revalidate: true },
    );
  });
});
