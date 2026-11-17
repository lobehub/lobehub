import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import type { QueuedMessage } from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';

import { canSteerClientRun, steerQueuedFollowUps } from './clientSteer';

vi.mock('@/services/message', () => ({ messageService: { createMessage: vi.fn() } }));

const queued = (
  id: string,
  content: string,
  extra: Partial<QueuedMessage> = {},
): QueuedMessage => ({
  content,
  createdAt: Number(id.slice(1)),
  id,
  interruptMode: 'soft',
  ...extra,
});

const createStore = (messages: QueuedMessage[]) => {
  const queue = { current: [...messages] };
  const store = {
    drainQueuedMessages: vi.fn((_key: string, options?: { limit?: number }) => {
      const taken = queue.current.slice(0, options?.limit ?? queue.current.length);
      queue.current = queue.current.slice(taken.length);
      return taken;
    }),
    internal_confirmClientMessages: vi.fn(),
    internal_dispatchMessage: vi.fn(),
    get queuedMessages() {
      return { key: queue.current };
    },
    requeueQueuedMessages: vi.fn((_key: string, back: QueuedMessage[]) => {
      queue.current = [...back, ...queue.current];
    }),
  } as unknown as ChatStore;
  return { get: () => store, queue, store };
};

const context = { agentId: 'agent-1', threadId: null, topicId: 'topic-1' };
const toolResultStep = {
  nextContext: { payload: { parentMessageId: 'tool-1' }, phase: 'tool_result' } as any,
  state: { messages: [{ id: 'tool-1', role: 'tool' }], status: 'running' } as any,
};
const steer = (get: () => ChatStore, step = toolResultStep) =>
  steerQueuedFollowUps(get, { context, contextKey: 'key', operationId: 'op-1', ...step });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(messageService.createMessage).mockResolvedValue({ id: 'x' } as any);
});

describe('canSteerClientRun', () => {
  it('takes plain text', () => {
    expect(canSteerClientRun(queued('q1', 'also check the tests'))).toBe(true);
  });

  it.each([
    ['no text', queued('q1', '  ')],
    ['a file', queued('q1', 'see this', { files: ['file-1'] })],
    [
      'a quoted selection',
      queued('q1', 'about this', {
        metadata: { contextSelections: [{ content: 'x', id: 's', source: 'text' }] } as any,
      }),
    ],
    ['a pinned runtime', queued('q1', 'go', { forceRuntime: 'gateway' })],
    [
      'a selected tool',
      queued('q1', 'search this', {
        editorData: {
          root: {
            children: [
              {
                children: [
                  {
                    actionCategory: 'tool',
                    actionLabel: 'Web Search',
                    actionType: 'web-search',
                    type: 'action-tag',
                  },
                  { text: ' search this', type: 'text' },
                ],
                type: 'paragraph',
              },
            ],
            type: 'root',
          },
        },
      }),
    ],
    ['a goal', queued('q1', '/goal ship it')],
  ])('leaves a message with %s to a turn of its own', (_label, message) => {
    expect(canSteerClientRun(message)).toBe(false);
  });
});

describe('steerQueuedFollowUps', () => {
  it('joins the leading messages into the run as one steer user message', async () => {
    const { get, queue, store } = createStore([
      queued('q1', 'first'),
      queued('q2', 'second'),
      queued('q3', 'with a file', { files: ['f'] }),
    ]);

    const steered = await steer(get);

    expect(messageService.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'first\n\nsecond',
        metadata: expect.objectContaining({ steer: true }),
        parentId: 'tool-1',
        role: 'user',
        topicId: 'topic-1',
      }),
    );
    const id = vi.mocked(messageService.createMessage).mock.calls[0][0].id;
    expect(steered?.nextContext).toMatchObject({
      payload: { parentMessageId: id },
      phase: 'user_input',
    });
    expect(steered?.state.messages.at(-1)).toMatchObject({ content: 'first\n\nsecond', id });
    // The attachment waits for the hand-back.
    expect(queue.current.map((m) => m.id)).toEqual(['q3']);
    expect(store.internal_confirmClientMessages).toHaveBeenCalledWith([id]);
  });

  it('takes nothing while a tool of this turn waits for approval', async () => {
    const { get, queue } = createStore([queued('q1', 'first')]);
    const waiting = {
      ...toolResultStep,
      state: {
        messages: [
          { id: 'a1', role: 'assistant', tools: [{ id: 't' }] },
          { id: 't1', parentId: 'a1', pluginIntervention: { status: 'pending' }, role: 'tool' },
        ],
      } as any,
    };

    await expect(steer(get, waiting)).resolves.toBeUndefined();
    expect(queue.current).toHaveLength(1);
  });

  it('only steers right before a model call', async () => {
    const { get } = createStore([queued('q1', 'first')]);
    const llmResult = { ...toolResultStep, nextContext: { phase: 'llm_result' } as any };

    await expect(steer(get, llmResult)).resolves.toBeUndefined();
    expect(messageService.createMessage).not.toHaveBeenCalled();
  });

  it('puts the messages back at the head of the queue when the write fails', async () => {
    vi.mocked(messageService.createMessage).mockRejectedValue(new Error('offline'));
    const { get, queue, store } = createStore([queued('q1', 'first'), queued('q2', 'second')]);

    await expect(steer(get)).resolves.toBeUndefined();

    expect(queue.current.map((m) => m.id)).toEqual(['q1', 'q2']);
    expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'deleteMessage' }),
      { operationId: 'op-1' },
    );
  });
});
