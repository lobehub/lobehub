import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExecutionSnapshot } from '../types';
import { replayTrajectory } from './replayTrajectory';

const connection = { headers: {}, serverUrl: 'https://example.test' };
const target = { label: 'p/m', model: 'm', provider: 'p' };

/** Two call_llm nodes: the first calls a tool, the second answers. */
const twoNodeSnapshot = (): ExecutionSnapshot =>
  ({
    completedAt: 2,
    operationId: 'op_1_agt_a_tpc_b_c',
    startedAt: 1,
    steps: [
      {
        completedAt: 2,
        content: 'looking it up',
        contextEngine: {
          output: [
            { content: 'system', role: 'system' },
            { content: 'question', role: 'user' },
          ],
        },
        executionTimeMs: 1,
        messagesDelta: [{ content: 'looking it up', role: 'assistant' }],
        startedAt: 1,
        stepIndex: 0,
        stepType: 'call_llm',
        toolsCalling: [{ apiName: 'readFile', identifier: 'fs' }],
        totalCost: 0,
        totalTokens: 0,
      },
      {
        completedAt: 2,
        executionTimeMs: 1,
        startedAt: 1,
        stepIndex: 1,
        stepType: 'call_tool',
        toolsResult: [{ apiName: 'readFile', identifier: 'fs', output: 'FILE BODY' }],
        totalCost: 0,
        totalTokens: 0,
      },
      {
        completedAt: 2,
        content: 'the answer is 42',
        contextEngine: {
          output: [
            { content: 'system', role: 'system' },
            { content: 'injected block', role: 'user' },
            { content: 'question', role: 'user' },
            { content: 'looking it up', role: 'assistant' },
            { content: 'FILE BODY', role: 'tool' },
          ],
        },
        executionTimeMs: 1,
        messagesDelta: [{ content: 'the answer is 42', role: 'assistant' }],
        startedAt: 1,
        stepIndex: 2,
        stepType: 'call_llm',
        totalCost: 0,
        totalTokens: 0,
      },
    ],
    totalCost: 0,
    totalSteps: 3,
    totalTokens: 0,
    traceId: 't',
  }) as unknown as ExecutionSnapshot;

type StubToolCall = string | { arguments?: string; name: string };

/** Stub the chat route, returning one scripted completion per call. */
const stubModel = (completions: Array<{ content?: string; toolCalls?: StubToolCall[] }>) => {
  const sent: any[] = [];
  let call = 0;

  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    const next = completions[Math.min(call++, completions.length - 1)];
    return {
      json: async () => ({
        choices: [
          {
            message: {
              content: next.content ?? '',
              tool_calls: next.toolCalls?.map((toolCall, index) => {
                const shaped = typeof toolCall === 'string' ? { name: toolCall } : toolCall;
                return {
                  function: { arguments: shaped.arguments ?? '{}', name: shaped.name },
                  id: `orig_${index}`,
                };
              }),
            },
          },
        ],
      }),
      ok: true,
    };
  });

  return sent;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('replayTrajectory', () => {
  it('replays every node and reports a matching trajectory as no divergence', async () => {
    stubModel([{ content: 'looking it up', toolCalls: ['fs____readFile'] }, { content: '42' }]);

    const result = await replayTrajectory({
      connection,
      mode: 'chain',
      snapshot: twoNodeSnapshot(),
      target,
    });

    expect(result.totalNodes).toBe(2);
    expect(result.nodes).toHaveLength(2);
    expect(result.divergedAtNode).toBeUndefined();
    expect(result.nodes.every((node) => node.divergence === undefined)).toBe(true);
  });

  it('feeds the recorded tool output back into the next node', async () => {
    const sent = stubModel([
      { content: 'looking it up', toolCalls: ['fs____readFile'] },
      { content: '42' },
    ]);

    await replayTrajectory({ connection, mode: 'chain', snapshot: twoNodeSnapshot(), target });

    const secondPayload = sent[1].messages;
    // The harness-rendered prefix survives, the model's turn replaces the
    // recorded one, and the tool result is spliced in behind it.
    expect(secondPayload.slice(0, 3).map((m: any) => m.content)).toEqual([
      'system',
      'injected block',
      'question',
    ]);
    expect(secondPayload.at(-1)).toMatchObject({ content: 'FILE BODY', role: 'tool' });
  });

  it('stops the chain at the first tool-call divergence by default', async () => {
    stubModel([{ content: 'guessing', toolCalls: ['fs____writeFile'] }]);

    const result = await replayTrajectory({
      connection,
      mode: 'chain',
      snapshot: twoNodeSnapshot(),
      target,
    });

    expect(result.divergedAtNode).toBe(0);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].divergence).toEqual({
      field: 'toolSignature',
      recorded: 'fs____readFile',
      replayed: 'fs____writeFile',
    });
    expect(result.nodes[0].unmatchedTools).toEqual(['fs____writeFile']);
  });

  it('keeps going past a divergence when asked to', async () => {
    stubModel([{ content: 'guessing', toolCalls: ['fs____writeFile'] }, { content: '43' }]);

    const result = await replayTrajectory({
      connection,
      mode: 'chain',
      onDivergence: 'continue',
      snapshot: twoNodeSnapshot(),
      target,
    });

    expect(result.divergedAtNode).toBe(0);
    expect(result.nodes).toHaveLength(2);
  });

  it('anchored mode replays every node against its own recorded payload', async () => {
    const sent = stubModel([
      { content: 'guessing', toolCalls: ['fs____writeFile'] },
      { content: '43' },
    ]);

    const result = await replayTrajectory({
      connection,
      mode: 'anchored',
      snapshot: twoNodeSnapshot(),
      target,
    });

    // A divergence at node 0 is recorded but does not contaminate node 1, whose
    // payload is the recorded one including the original assistant turn.
    expect(result.divergedAtNode).toBe(0);
    expect(result.nodes).toHaveLength(2);
    expect(sent[1].messages.map((m: any) => m.content)).toEqual([
      'system',
      'injected block',
      'question',
      'looking it up',
      'FILE BODY',
    ]);
  });

  // The recorded run read "a"; the replay reads "b". Tool names match, so
  // toolSignature sees nothing — but the recording holds no output for "b", and
  // feeding it the body of "a" would produce a falsely successful chain.
  it('treats the same tool called with different arguments as a divergence', async () => {
    const snap = twoNodeSnapshot();
    snap.steps[0].toolsCalling = [
      { apiName: 'readFile', arguments: '{"path":"a"}', identifier: 'fs' },
    ];
    stubModel([
      {
        content: 'looking it up',
        toolCalls: [{ arguments: '{"path":"b"}', name: 'fs____readFile' }],
      },
    ]);

    const result = await replayTrajectory({ connection, mode: 'chain', snapshot: snap, target });

    expect(result.nodes[0].unmatchedTools).toEqual(['fs____readFile']);
    expect(result.nodes[0].divergence).toEqual({
      field: 'toolArguments',
      recorded: 'fs____readFile({"path":"a"})',
      replayed: 'fs____readFile({"path":"b"})',
    });
    expect(result.divergedAtNode).toBe(0);
    // Stopped rather than continuing on a tool result it never earned.
    expect(result.nodes).toHaveLength(1);
  });

  it('reports a lost anchor as incomplete instead of a finished trajectory', async () => {
    const snap = twoNodeSnapshot();
    // Compression rewrote node 1's payload so no earlier assistant turn is left
    // to splice the replayed tail onto.
    (snap.steps[2] as any).contextEngine = {
      output: [{ content: 'compressed summary', role: 'user' }],
    };
    stubModel([{ content: 'looking it up', toolCalls: ['fs____readFile'] }, { content: '42' }]);

    const result = await replayTrajectory({
      connection,
      mode: 'chain',
      reproductionJudge: { judgeModel: target },
      snapshot: snap,
      target,
    });

    expect(result.incomplete).toEqual({ nodeIndex: 1, reason: 'anchor_lost' });
    expect(result.nodes).toHaveLength(1);
    expect(result.totalNodes).toBe(2);
    // A truncated run has no whole-run output to score.
    expect(result.reproduction).toBeUndefined();
  });

  it('stops when a node errors', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, text: async () => 'boom' }));

    const result = await replayTrajectory({
      connection,
      mode: 'chain',
      snapshot: twoNodeSnapshot(),
      target,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].attempt.error).toContain('500');
  });
});
