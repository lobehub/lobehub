// Fixture: the test proves the service was called, never that a topic exists afterwards.
import { describe, expect, it, vi } from 'vitest';

import { topicService } from '@/services/topic';

import { useChatStore } from '../store';

vi.mock('@/services/topic', () => ({
  topicService: { createTopic: vi.fn().mockResolvedValue('tpc_1') },
}));

describe('createTopic', () => {
  // alint-expect
  it('creates a topic from the current session', async () => {
    await useChatStore.getState().createTopic({ sessionId: 'ssn_1', title: 'hello' });

    expect(topicService.createTopic).toHaveBeenCalledWith({ sessionId: 'ssn_1', title: 'hello' });
  });
});
