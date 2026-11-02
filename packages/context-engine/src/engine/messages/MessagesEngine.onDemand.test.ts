import type { UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessagesEngine } from './MessagesEngine';
import type { MessagesEngineParams } from './types';

const processOnDemandMessages = vi.hoisted(() => vi.fn());

vi.mock('../../onDemand/messages', () => ({
  processOnDemandMessages,
}));

const message: UIChatMessage = {
  content: 'Hello',
  createdAt: 1,
  id: 'u1',
  role: 'user',
  updatedAt: 1,
} as UIChatMessage;

const params: MessagesEngineParams = {
  enableSystemDate: false,
  messages: [message],
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'You are a helper.',
};

describe('MessagesEngine context mode isolation', () => {
  beforeEach(() => {
    processOnDemandMessages.mockReset();
    processOnDemandMessages.mockResolvedValue({
      messages: [{ content: 'on-demand', role: 'system' }],
      metadata: {},
      stats: { processedCount: 1, processorDurations: {}, totalDuration: 0 },
    });
  });

  it('never invokes the on-demand pipeline in legacy and default modes', async () => {
    await new MessagesEngine(params).process();
    await new MessagesEngine({ ...params, contextMode: 'default' }).process();

    expect(processOnDemandMessages).not.toHaveBeenCalled();
  });

  it('routes only explicit on-demand mode through the isolated pipeline', async () => {
    await new MessagesEngine({ ...params, contextMode: 'on-demand' }).process();

    expect(processOnDemandMessages).toHaveBeenCalledTimes(1);
    expect(processOnDemandMessages).toHaveBeenCalledWith(
      {
        ...params,
        contextMode: 'on-demand',
      },
      expect.objectContaining({ genToolCallingName: expect.any(Function) }),
    );
  });
});
