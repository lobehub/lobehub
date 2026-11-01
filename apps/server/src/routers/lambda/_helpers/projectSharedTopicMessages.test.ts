import { parse } from '@lobechat/conversation-flow';
import {
  AgentRuntimeErrorType,
  ChatErrorType,
  type ChatMessageError,
  type UIChatMessage,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { projectSharedTopicMessages } from './projectSharedTopicMessages';

const rawError = {
  body: {
    error: { message: 'sensitive upstream diagnostic' },
    provider: 'example',
    traceId: 'trace-123',
  },
  message: '400 sensitive upstream diagnostic',
  type: AgentRuntimeErrorType.UpstreamGatewayError,
} satisfies ChatMessageError;

const message = (id: string, extra: Partial<UIChatMessage> = {}): UIChatMessage => ({
  content: 'Shared answer',
  createdAt: 1,
  id,
  role: 'assistant',
  updatedAt: 1,
  ...extra,
});

describe('projectSharedTopicMessages', () => {
  it('removes stored upstream diagnostics from nested runtime error fields', () => {
    const messages = [
      message('group', {
        children: [
          {
            content: 'Step',
            council: [message('council', { error: rawError })],
            error: rawError,
            id: 'step',
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
        tasks: [message('nested-task', { error: rawError })],
      }),
    ];

    const result = projectSharedTopicMessages(messages);
    const safeError = {
      body: { traceId: 'trace-123' },
      type: ChatErrorType.InternalServerError,
    };

    expect(result[0].error).toEqual(safeError);
    expect(result[0].children?.[0].error).toEqual(safeError);
    expect(result[0].children?.[0].council?.[0].error).toEqual(safeError);
    expect(result[0].compressedMessages?.[0].error).toEqual(safeError);
    expect(result[0].members?.[0].error).toEqual(safeError);
    expect(result[0].tasks?.[0].error).toEqual(safeError);
    expect(result[0].taskCompletions?.[0].error).toEqual(safeError);
    expect(result[0].children?.[0].tools?.[0].result).toMatchObject({
      content: 'Public result',
      error: undefined,
    });
    expect(result[0].pluginError).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('sensitive upstream diagnostic');
    expect(messages[0].error).toEqual(rawError);
  });

  it('keeps normal shared content and discards malformed diagnostic identifiers', () => {
    const input = [
      message('answer', {
        content: 'The model answer',
        error: {
          body: { traceId: { value: 'invalid' } },
          message: 'secret',
          type: AgentRuntimeErrorType.UpstreamGatewayError,
        },
      }),
    ];

    const result = projectSharedTopicMessages(input);

    expect(result[0].content).toBe('The model answer');
    expect(result[0].error).toEqual({ type: ChatErrorType.InternalServerError });
  });

  it('redacts stored errors in compressed comparison columns', () => {
    const { flatList } = parse([
      message('question', {
        content: 'Compare these answers',
        metadata: { compare: true },
        role: 'user',
      }),
      message('answer-1', { error: rawError, parentId: 'question' }),
      message('answer-2', { parentId: 'question' }),
    ]);

    expect(flatList.some((item) => item.columns?.length === 2)).toBe(true);
    expect(JSON.stringify(flatList)).toContain('sensitive upstream diagnostic');

    const result = projectSharedTopicMessages([
      message('compressed', { compressedMessages: flatList, role: 'compressedGroup' }),
    ]);

    expect(JSON.stringify(result)).not.toContain('sensitive upstream diagnostic');
    expect(
      result[0].compressedMessages?.find((item) => item.columns?.length === 2)?.columns?.[0][0]
        .error,
    ).toEqual({
      body: { traceId: 'trace-123' },
      type: ChatErrorType.InternalServerError,
    });
  });
});
