import { describe, expect, it, vi } from 'vitest';

import type { McpEventsExecutionService } from './index';
import { McpEventsExecutionRuntime } from './index';

const createRuntime = () => {
  const service: McpEventsExecutionService = {
    listEventTypes: vi.fn().mockResolvedValue({ eventTypes: [] }),
    listSubscriptions: vi.fn().mockResolvedValue({ subscriptions: [] }),
    subscribeEvent: vi.fn(),
    unsubscribeEvent: vi.fn(),
  };
  const runtime = new McpEventsExecutionRuntime(service, {
    agentId: 'agent-current',
    topicId: 'topic-current',
  });
  return { runtime, service };
};

describe('MCP Events execution', () => {
  it('binds all operations to the executing agent and topic, ignoring model-supplied scopes', async () => {
    const { runtime, service } = createRuntime();
    const removed = { removed: true, subscriptionId: 'other-topic-subscription' };
    vi.mocked(service.unsubscribeEvent).mockImplementation(async (args) => {
      // The service owns the resource check; this stand-in rejects a subscription in another topic.
      if (args.topicId !== 'topic-other')
        throw Object.assign(new Error('Subscription not found in this topic'), {
          code: 'not_found',
        });
      return removed as { removed: true; subscriptionId: string };
    });
    const args = {
      agentId: 'agent-other',
      topicId: 'topic-other',
      subscriptionId: 'other-topic-subscription',
    };
    const result = await runtime.unsubscribeEvent(args);
    expect(result).toMatchObject({ success: false, state: { error: { code: 'not_found' } } });
    expect(service.unsubscribeEvent).toHaveBeenCalledWith({
      agentId: 'agent-current',
      topicId: 'topic-current',
      subscriptionId: args.subscriptionId,
    });

    await runtime.subscribeEvent({
      ...args,
      connector: 'linear',
      instructions: 'Notify me',
      name: 'issue.created',
    });
    expect(service.subscribeEvent).toHaveBeenCalledWith({
      agentId: 'agent-current',
      topicId: 'topic-current',
      connector: 'linear',
      instructions: 'Notify me',
      name: 'issue.created',
      arguments: undefined,
    });
    await runtime.listSubscriptions();
    expect(service.listSubscriptions).toHaveBeenCalledWith({
      agentId: 'agent-current',
      topicId: 'topic-current',
    });
    await runtime.listEventTypes({ connector: 'linear' });
    expect(service.listEventTypes).toHaveBeenCalledWith({
      agentId: 'agent-current',
      connector: 'linear',
    });
  });

  it('preserves structured successful output for the model and result card', async () => {
    const { runtime, service } = createRuntime();
    const state = {
      eventTypes: [
        {
          connector: { identifier: 'linear', name: 'Linear' },
          name: 'issue.created',
          subscribable: true,
        },
      ],
    };
    vi.mocked(service.listEventTypes).mockResolvedValue(state);
    const result = await runtime.listEventTypes();
    expect(result).toEqual({ success: true, state, content: JSON.stringify(state) });
  });

  it.each([
    'feature_disabled',
    'forbidden',
    'invalid_arguments',
    'callback_unreachable',
    'limit_reached',
  ])('returns a stable %s error code in state and the error envelope', async (code) => {
    const { runtime, service } = createRuntime();
    vi.mocked(service.listEventTypes).mockRejectedValue(
      Object.assign(new Error('A readable error'), { code }),
    );
    expect(await runtime.listEventTypes()).toEqual({
      success: false,
      content: 'A readable error',
      error: { type: code, message: 'A readable error' },
      state: { error: { code, message: 'A readable error' } },
    });
  });

  it('normalizes unknown provider error codes', async () => {
    const { runtime, service } = createRuntime();
    vi.mocked(service.listEventTypes).mockRejectedValue(
      Object.assign(new Error('Unavailable'), { code: 503 }),
    );
    expect(await runtime.listEventTypes()).toMatchObject({
      success: false,
      state: { error: { code: 'unknown', message: 'Unavailable' } },
    });
  });
});
