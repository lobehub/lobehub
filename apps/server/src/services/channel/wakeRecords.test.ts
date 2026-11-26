// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelRoutingInput } from './wake';
import {
  CHANNEL_ROUTING_POLICY_ID,
  CHANNEL_WAKE_PIPELINE_VERSION,
  recordChannelWakeDecisions,
} from './wakeRecords';

const { record } = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('@/server/services/agentSignal/persistence/recordDecision', () => ({
  recordSignalDecision: record,
}));

const candidate = (memberId: string, ownerId: string | null = 'owner') => ({
  agentId: `agt-${memberId}`,
  description: '',
  memberId,
  name: memberId,
  ownerId,
  silentWakes: 0,
});

const input = {
  attempt: 1,
  candidates: [candidate('coder'), candidate('reviewer'), candidate('orphan', null)],
  fallback: false,
  message: 'Anyone around?',
  messageId: 'msg',
  threadId: null,
  workspaceId: 'ws',
} as unknown as ChannelRoutingInput;

const rowFor = (memberId: string) =>
  record.mock.calls
    .map(([, params]) => params)
    .find((params) => params.scopeKey.endsWith(memberId));

describe('Channel wake decision rows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('files one row per judged member under its Agent owner, with why it woke', async () => {
    await recordChannelWakeDecisions(
      {} as never,
      'chn',
      input,
      {
        memberIds: ['coder'],
        reason: 'Woken by its own rules',
        status: 'assigned',
        wakes: { coder: { kind: 'followup', reason: 'followup-window' } },
      },
      {
        answers: { reviewer: { probability: 0.1, type: 'boolean' } },
        judgements: [
          {
            excluded: false,
            initiation: { addressed: false, reason: 'followup-window' },
            memberId: 'coder',
            quiet: false,
            verdicts: [
              {
                confidence: 0.9,
                latencyMs: 3,
                mode: 'enforce',
                policyId: 'bot-wake:classifier',
                reason: 'addressed',
                verdict: 'allow',
                version: 1,
              },
            ],
          },
          { excluded: false, memberId: 'reviewer', quiet: false },
        ],
      },
      { recipients: ['coder'], status: 'assigned' },
    );

    // An Agent without an owner has nowhere to be read from.
    expect(record).toHaveBeenCalledTimes(2);
    expect(rowFor('coder')).toMatchObject({
      agentId: 'agt-coder',
      decision: {
        finalReason: 'followup-window',
        outcome: 'wake',
        pipelineVersion: CHANNEL_WAKE_PIPELINE_VERSION,
        verdicts: [expect.objectContaining({ policyId: 'bot-wake:classifier' })],
      },
      scopeKey: 'lobehub:chn:coder',
      signal: { externalId: 'chn:msg:coder:1', payload: { text: 'Anyone around?' } },
      userId: 'owner',
      workspaceId: 'ws',
    });
    expect(rowFor('reviewer')).toMatchObject({
      decision: {
        finalReason: 'not-chosen',
        outcome: 'skip',
        verdicts: [
          expect.objectContaining({
            confidence: 0.1,
            policyId: CHANNEL_ROUTING_POLICY_ID,
            verdict: 'deny',
          }),
        ],
      },
    });
  });

  it('records which woken member led and which followed its reply', async () => {
    await recordChannelWakeDecisions(
      {} as never,
      'chn',
      input,
      {
        memberIds: ['reviewer', 'coder'],
        reason: 'Selected by the Channel decision model; the others follow its reply',
        status: 'assigned',
        wakes: {
          coder: { afterMemberId: 'reviewer', kind: 'followup', reason: 'routing-deferred' },
        },
      },
      {
        answers: {
          coder: { probability: 0.8, type: 'boolean' },
          reviewer: { probability: 0.95, type: 'boolean' },
        },
      },
      { recipients: ['reviewer', 'coder'], status: 'assigned' },
    );

    expect(rowFor('reviewer')).toMatchObject({
      decision: {
        finalReason: 'routing-selected',
        metadata: { stateSnapshot: { responder: 'primary' } },
        outcome: 'wake',
      },
    });
    expect(rowFor('coder')).toMatchObject({
      decision: {
        finalReason: 'routing-deferred',
        metadata: { stateSnapshot: { primaryMemberId: 'reviewer', responder: 'deferred' } },
        outcome: 'wake',
      },
    });
  });

  it('records nothing for fallback routing, and survives a failed write', async () => {
    await recordChannelWakeDecisions(
      {} as never,
      'chn',
      { ...input, fallback: true },
      { memberIds: ['coder'], reason: 'fallback', status: 'assigned' },
      {},
      { recipients: ['coder'], status: 'assigned' },
    );
    expect(record).not.toHaveBeenCalled();

    record.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      recordChannelWakeDecisions(
        {} as never,
        'chn',
        input,
        { reason: 'Nobody', status: 'skipped' },
        {},
        { recipients: [], status: 'skipped' },
      ),
    ).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('records what was delivered, not what the decision proposed', async () => {
    await recordChannelWakeDecisions(
      {} as never,
      'chn',
      input,
      {
        memberIds: ['coder', 'reviewer'],
        reason: 'Both fit',
        status: 'assigned',
        wakes: {
          coder: { kind: 'followup', reason: 'followup-window' },
          reviewer: { kind: 'followup', reason: 'followup-window' },
        },
      },
      { answers: { reviewer: { probability: 0.9, type: 'boolean' } } },
      // The reviewer left while the model was running, so it received nothing.
      { recipients: ['coder'], status: 'assigned' },
    );

    expect(rowFor('coder')).toMatchObject({
      decision: { finalReason: 'followup-window', outcome: 'wake' },
    });
    expect(rowFor('reviewer')).toMatchObject({
      decision: {
        finalReason: 'not-chosen',
        outcome: 'skip',
        verdicts: [expect.objectContaining({ verdict: 'deny' })],
      },
    });
  });

  it('reports an unassigned message as unassigned when no proposed member was delivered to', async () => {
    await recordChannelWakeDecisions(
      {} as never,
      'chn',
      input,
      {
        memberIds: ['coder'],
        reason: 'Woken by its own rules',
        status: 'assigned',
        wakes: { coder: { kind: 'followup', reason: 'followup-window' } },
      },
      {},
      { recipients: [], status: 'unassigned' },
    );

    expect(rowFor('coder')).toMatchObject({
      decision: { finalReason: 'unassigned', outcome: 'skip' },
    });
  });
});
