import { ChatErrorType, type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { projectSharedTopicMessages } from './projectSharedTopicMessages';

const rawError = {
  body: {
    error: { message: 'sensitive upstream diagnostic' },
    provider: 'example',
    traceId: 'trace-123',
  },
  message: '400 sensitive upstream diagnostic',
  type: 'UpstreamGatewayError',
};

const message = (id: string, extra: Partial<UIChatMessage> = {}): UIChatMessage => ({
  content: 'Shared answer',
  createdAt: 1,
  id,
  role: 'assistant',
  ...extra,
});

describe('projectSharedTopicMessages', () => {
  it('removes stored upstream diagnostics from every displayed message level', () => {
    const messages = [
      message('group', {
        children: [
          {
            content: 'Step',
            council: [message('council', { error: rawError })],
            error: rawError,
            id: 'step',
            tasks: [{ error: 'internal task failure', id: 'task-1' }],
            tools: [
              {
                apiName: 'search',
                arguments: '{}',
                id: 'tool-1',
                identifier: 'builtin',
                result: {
                  content: 'Public result',
                  error: 'internal tool failure',
                  id: 'result-1',
                },
                type: 'builtin',
              },
            ],
          },
        ],
        compressedMessages: [message('compressed', { error: rawError })],
        error: rawError,
        members: [message('member', { error: rawError })],
        pluginError: { message: 'internal plugin failure' },
        taskCompletions: [{ content: 'Done', error: rawError, id: 'completion' }],
        taskDetail: {
          error: { message: 'internal task detail' },
          status: 'failed',
          threadId: 't1',
        },
        tasks: [message('nested-task', { error: rawError })],
      }),
    ];

    const result = projectSharedTopicMessages(messages);
    const safeError = { type: ChatErrorType.InternalServerError };

    expect(result[0].error).toEqual(safeError);
    expect(result[0].children?.[0].error).toEqual(safeError);
    expect(result[0].children?.[0].council?.[0].error).toEqual(safeError);
    expect(result[0].compressedMessages?.[0].error).toEqual(safeError);
    expect(result[0].members?.[0].error).toEqual(safeError);
    expect(result[0].tasks?.[0].error).toEqual(safeError);
    expect(result[0].taskCompletions?.[0].error).toEqual(safeError);
    expect(result[0].children?.[0].tasks?.[0].error).toBeUndefined();
    expect(result[0].children?.[0].tools?.[0].result).toMatchObject({
      content: 'Public result',
      error: undefined,
    });
    expect(result[0].taskDetail?.error).toBeUndefined();
    expect(result[0].pluginError).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('sensitive upstream diagnostic');
    expect(messages[0].error).toEqual(rawError);
  });

  it('keeps normal shared content and discards diagnostic identifiers', () => {
    const input = [
      message('answer', {
        content: 'The model answer',
        error: { body: { traceId: { value: 'invalid' } }, message: 'secret', type: 'Other' },
      }),
    ];

    const result = projectSharedTopicMessages(input);

    expect(result[0].content).toBe('The model answer');
    expect(result[0].error).toEqual({ type: ChatErrorType.InternalServerError });
  });
});
