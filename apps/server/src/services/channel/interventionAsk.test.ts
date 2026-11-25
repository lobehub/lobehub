// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { answerIntervention, mirrorInterventionsToChannel } from './interventionAsk';

const repo = vi.hoisted(() => ({
  closeInterventionAsk: vi.fn(),
  postInterventionAsk: vi.fn(),
}));
const notifyChannel = vi.hoisted(() => vi.fn());
const submitHeteroInterventionAs = vi.hoisted(() => vi.fn());

vi.mock('@/database/repositories/channel/interventionAsk', () => repo);
vi.mock('./notify', () => ({ notifyChannel }));
vi.mock('@/server/routers/lambda/aiAgent/heteroInterventionSubmit', () => ({
  submitHeteroInterventionAs,
}));

/** A db whose selects resolve to `rows` and whose updates succeed. */
const fakeDb = (rows: unknown[] = []) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ['select', 'from', 'innerJoin', 'update', 'set'])
    chain[name] = vi.fn(() => chain);
  // An update ends at `where`; a select goes on to `limit`.
  chain.where = vi.fn(() => Object.assign(Promise.resolve(), chain));
  chain.limit = vi.fn(async () => rows);
  return chain as unknown as LobeChatDatabase & { update: ReturnType<typeof vi.fn> };
};

const questions = [{ options: [{ label: 'Close' }, { label: 'Keep' }], question: 'Close them?' }];

const request = (args: unknown, extra: Record<string, unknown> = {}): AgentStreamEvent =>
  ({
    data: {
      apiName: 'askUserQuestion',
      arguments: JSON.stringify(args),
      deadline: 1,
      identifier: 'claude-code',
      interactionKind: 'question',
      provider: 'claude-code',
      toolCallId: 'toolu_1',
      ...extra,
    },
    operationId: 'op-1',
    stepIndex: 0,
    timestamp: 1,
    type: 'agent_intervention_request',
  }) as AgentStreamEvent;

const params = (events: AgentStreamEvent[]) => ({ events, operationId: 'op-1', topicId: 'tpc-1' });

beforeEach(() => vi.clearAllMocks());

describe('mirrorInterventionsToChannel', () => {
  it('posts a question card and marks the topic card as asked in the Channel', async () => {
    repo.postInterventionAsk.mockResolvedValue({ channelId: 'ch-1', messageId: 'msg-1' });
    const db = fakeDb([{ id: 'tool-msg' }]);

    await mirrorInterventionsToChannel(db, params([request({ questions })]));

    expect(repo.postInterventionAsk).toHaveBeenCalledWith(
      db,
      { operationId: 'op-1', toolCallId: 'toolu_1' },
      { questions },
    );
    expect(db.update).toHaveBeenCalled();
    expect(notifyChannel).toHaveBeenCalledWith(db, 'ch-1');
  });

  it('leaves permission prompts and provider-owned options in the topic', async () => {
    const db = fakeDb();
    await mirrorInterventionsToChannel(
      db,
      params([
        request({ questions }, { interactionKind: 'permission' }),
        request({ claudeCodePermission: {}, questions }),
        request({
          questions: [
            {
              options: [
                { id: 'a', label: 'A' },
                { id: 'b', label: 'B' },
              ],
              question: 'Q',
            },
          ],
        }),
        request({ questions: [{ options: [{ label: 'Only one' }], question: 'Q' }] }),
      ]),
    );
    expect(repo.postInterventionAsk).not.toHaveBeenCalled();
  });

  it('closes the card when the run settles the question, and survives failures', async () => {
    repo.postInterventionAsk.mockRejectedValue(new Error('db down'));
    repo.closeInterventionAsk.mockResolvedValue('ch-1');
    const db = fakeDb();
    await mirrorInterventionsToChannel(
      db,
      params([
        request({ questions }),
        {
          data: { cancelReason: 'timeout', cancelled: true, toolCallId: 'toolu_1' },
          operationId: 'op-1',
          stepIndex: 0,
          timestamp: 2,
          type: 'agent_intervention_response',
        } as AgentStreamEvent,
      ]),
    );
    expect(repo.closeInterventionAsk).toHaveBeenCalledWith(db, {
      operationId: 'op-1',
      toolCallId: 'toolu_1',
    });
    expect(notifyChannel).toHaveBeenCalledWith(db, 'ch-1');
  });
});

describe('answerIntervention', () => {
  it('hands the card answer to the blocked run as its owner', async () => {
    const db = fakeDb([{ userId: 'owner', workspaceId: 'ws' }]);
    await answerIntervention(db, {
      answer: {
        answeredAt: 'now',
        answers: [{ selected: ['Keep'] }],
        memberId: 'm1',
      },
      bodyLength: 0,
      intervention: { operationId: 'op-1', toolCallId: 'toolu_1' },
      questions,
      requesterMemberId: 'm1',
      status: 'answered',
    });
    expect(submitHeteroInterventionAs).toHaveBeenCalledWith(
      {
        operationId: 'op-1',
        result: { 'Close them?': 'Keep' },
        stepIndex: 0,
        toolCallId: 'toolu_1',
      },
      { userId: 'owner', workspaceId: 'ws' },
    );
  });
});
