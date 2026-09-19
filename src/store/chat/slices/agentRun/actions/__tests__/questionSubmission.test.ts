import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { messagesReducer } from '@/store/chat/slices/message/reducer';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import type { StoreSetter } from '@/store/types';

import { QuestionSubmissionActionImpl } from '../entries/questionSubmission';
import { createMockMessage } from './fixtures';

vi.mock('@/services/message', () => ({ messageService: { getMessages: vi.fn() } }));

const context = { agentId: 'agent-question', topicId: 'topic-question' };
const key = messageMapKey(context);
const question = createMockMessage({
  content: '',
  id: 'question',
  plugin: {
    apiName: 'askUserQuestion',
    arguments: '{}',
    identifier: 'lobe-agent',
    type: 'default',
  },
  pluginIntervention: { batchId: 'batch', operationId: 'operation', status: 'pending' },
  pluginState: { askUserDraft: { picks: { Color: ['Blue'] }, supplementText: 'Keep my note' } },
  role: 'tool',
  tool_call_id: 'call-question',
});

const createAction = () => {
  const state = {
    dbMessagesMap: { [key]: [question] },
    questionSubmissions: {},
    refreshMessages: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatStore;
  state.internal_dispatchMessage = (payload) => {
    state.dbMessagesMap[key] = messagesReducer(state.dbMessagesMap[key], payload);
  };
  const set: StoreSetter<ChatStore> = (update) => {
    Object.assign(state, typeof update === 'function' ? update(state) : update);
  };
  const action = new QuestionSubmissionActionImpl(set, () => state);
  return { action, state };
};

beforeEach(() => {
  vi.mocked(messageService.getMessages).mockReset();
});

describe('question submission feedback', () => {
  it('collapses immediately without changing the pending row and blocks duplicate clicks', async () => {
    const { action, state } = createAction();
    const request = Promise.withResolvers<void>();
    const submit = vi.fn(() => request.promise);
    const pending = action.runQuestionSubmission(question.id, context, submit);
    expect(state.questionSubmissions.question).toBe('submitting');
    expect(state.dbMessagesMap[key][0]).toEqual(question);
    await action.runQuestionSubmission(question.id, context, submit);
    expect(submit).toHaveBeenCalledOnce();
    request.resolve();
    await pending;
    expect(state.questionSubmissions.question).toBeUndefined();
  });

  it.each(['submit_answers', 'skip_interaction'] as const)(
    'settles %s locally on confirmation without waiting for message revalidation',
    async (type) => {
      const { action, state } = createAction();
      state.refreshMessages = vi.fn(() => new Promise<void>(() => {}));
      action.internal_confirmQuestionSubmission(
        question.id,
        type === 'submit_answers' ? { type, result: { Color: ['Blue'] } } : { type },
        context,
      );
      expect(state.dbMessagesMap[key][0].pluginIntervention?.status).toBe(
        type === 'submit_answers' ? 'approved' : 'rejected',
      );
      expect(state.dbMessagesMap[key][0].pluginState).toMatchObject(question.pluginState!);
      if (type === 'submit_answers') {
        expect(state.dbMessagesMap[key][0].pluginState).toHaveProperty('askUserAnswers', {
          Color: ['Blue'],
        });
      }
    },
  );

  it('restores the saved answers after a failed submit and authoritative pending read', async () => {
    const { action, state } = createAction();
    const error = new Error('submit failed');
    vi.mocked(messageService.getMessages).mockResolvedValue([question]);
    await expect(
      action.runQuestionSubmission(question.id, context, async () => {
        throw error;
      }),
    ).rejects.toThrow(error);
    expect(state.questionSubmissions.question).toBe('failed');
    expect(state.dbMessagesMap[key][0].pluginState).toEqual(question.pluginState);
    const retry = vi.fn().mockResolvedValue(undefined);
    await action.runQuestionSubmission(question.id, context, retry);
    expect(retry).toHaveBeenCalledOnce();
  });

  it('adopts a server-confirmed answer after a lost response without reopening the form', async () => {
    const { action, state } = createAction();
    vi.mocked(messageService.getMessages).mockResolvedValue([
      {
        ...question,
        content: 'Already answered',
        pluginIntervention: { status: 'approved' },
        pluginState: { askUserAnswers: { Color: ['Red'] } },
      },
    ]);
    await action.runQuestionSubmission(question.id, context, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(state.questionSubmissions.question).toBeUndefined();
    expect(state.dbMessagesMap[key][0].pluginState).toMatchObject({
      askUserAnswers: { Color: ['Red'] },
    });
    expect(state.dbMessagesMap[key][0].pluginIntervention?.status).toBe('approved');
  });

  it('keeps an unconfirmed response collapsed until checking succeeds', async () => {
    const { action, state } = createAction();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(messageService.getMessages).mockRejectedValueOnce(new Error('offline'));
    await expect(
      action.runQuestionSubmission(question.id, context, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(state.questionSubmissions.question).toBe('uncertain');
    const submit = vi.fn();
    await action.runQuestionSubmission(question.id, context, submit);
    expect(submit).not.toHaveBeenCalled();
    vi.mocked(messageService.getMessages).mockResolvedValueOnce([question]);
    await action.checkQuestionSubmission(question.id, context);
    expect(state.questionSubmissions.question).toBe('failed');
    log.mockRestore();
  });

  it('does not reopen an accepted answer when connecting its continuation fails', async () => {
    const { action, state } = createAction();
    await expect(
      action.runQuestionSubmission(question.id, context, async () => {
        action.internal_confirmQuestionSubmission(
          question.id,
          { type: 'submit_answers', result: { Color: ['Blue'] } },
          context,
        );
        throw new Error('connection failed');
      }),
    ).rejects.toThrow('connection failed');
    expect(state.questionSubmissions.question).toBeUndefined();
    expect(state.dbMessagesMap[key][0].pluginIntervention?.status).toBe('approved');
    expect(messageService.getMessages).not.toHaveBeenCalled();
  });
});
