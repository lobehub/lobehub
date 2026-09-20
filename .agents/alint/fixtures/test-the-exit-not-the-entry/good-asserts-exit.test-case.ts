// Fixture: the test asserts the state the caller observes after the action.
import { describe, expect, it, vi } from 'vitest';

import { useChatStore } from '../store';

vi.mock('@/services/topic', () => ({
  topicService: { createTopic: vi.fn().mockResolvedValue('tpc_1') },
}));

describe('createTopic', () => {
  it('creates a topic and selects it', async () => {
    const id = await useChatStore.getState().createTopic({ sessionId: 'ssn_1', title: 'hello' });

    expect(id).toBe('tpc_1');
    expect(useChatStore.getState().activeTopicId).toBe('tpc_1');
    expect(useChatStore.getState().topicMaps['ssn_1']?.map((t) => t.id)).toContain('tpc_1');
  });
});
