// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { readMessagesByCursor } from './messagesByCursor';
import { readTopicPreviews } from './topicPreviews';

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(async () => ({ enableTopicPreview: true })),
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      findByIds: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, status: 'active', updatedAt: new Date(0) })),
      ),
    };
  }),
}));
vi.mock('./messagesByCursor', () => ({ readMessagesByCursor: vi.fn() }));

describe('readTopicPreviews', () => {
  it('reads one topic at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(readMessagesByCursor).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { messages: [] } as any;
    });

    const items = await readTopicPreviews(
      { serverDB: {} as any, userId: 'user_1' },
      { agentId: 'agt_1', topicIds: ['tpc_a', 'tpc_b', 'tpc_c', 'tpc_d'] },
    );

    expect(items).toHaveLength(4);
    expect(maxInFlight).toBe(1);
  });
});
