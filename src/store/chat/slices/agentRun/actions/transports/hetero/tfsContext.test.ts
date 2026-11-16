import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withHeteroContext } from './tfsContext';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/services/tfs/agentContext', () => ({ loadTfsAgentContext: mocks.load }));
vi.mock('../viewedTaskPrompt', () => ({
  withHeteroContext: (base?: string) => base,
}));

describe('desktop TFS repository context', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.load.mockResolvedValue('TFS repository and branch');
  });

  it('passes source metadata to the local CLI alongside its existing instructions', async () => {
    const result = await withHeteroContext({ systemContext: 'Agent rules' }, 'clone', {
      topicId: 'topic-1',
    });
    expect(result).toBe('Agent rules\n\nTFS repository and branch');
    expect(mocks.load).toHaveBeenCalledWith('topic-1');
  });

  it('preserves GitHub and non-project CLI context exactly', async () => {
    mocks.load.mockResolvedValue(undefined);
    expect(
      await withHeteroContext({ systemContext: 'GitHub rules' }, 'clone', { topicId: 'topic' }),
    ).toBe('GitHub rules');
  });

  it('never fetches creator metadata for a share visitor or an absent topic', async () => {
    expect(
      await withHeteroContext({ systemContext: 'rules' }, 'hello', {
        topicId: 'topic',
        agentShareId: 'share',
      }),
    ).toBe('rules');
    expect(await withHeteroContext({ systemContext: 'rules' }, 'hello', {})).toBe('rules');
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
