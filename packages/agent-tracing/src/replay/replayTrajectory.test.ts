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

    const result = await replayTrajectory({ connection, snapshot: twoNodeSnapshot(), target });

    expect(result.totalNodes).toBe(2);
    expect(result.nodes).toHaveLength(2);
    expect(result.divergedAtNode).toBeUndefined();
    expect(result.nodes.every((node) => node.divergence === undefined)).toBe(true);
  });

  it('replays each node against its own recorded payload', async () => {
    const sent = stubModel([
      { content: 'guessing', toolCalls: ['fs____writeFile'] },
      { content: '43' },
    ]);

    const result = await replayTrajectory({
      concurrency: 1,
      connection,
      snapshot: twoNodeSnapshot(),
      target,
    });

    // Node 0 diverged, but node 1 still gets the payload the harness built for
    // it — including the ORIGINAL assistant turn and tool result, not the
    // replayed ones. That independence is the point of the mode.
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

  it('a divergence never stops the nodes after it', async () => {
    stubModel([{ content: 'guessing', toolCalls: ['fs____writeFile'] }, { content: '43' }]);

    const result = await replayTrajectory({ connection, snapshot: twoNodeSnapshot(), target });

    expect(result.divergedAtNode).toBe(0);
    expect(result.nodes).toHaveLength(2);
  });

  it('a node that cannot reach the model costs only itself', async () => {
    let call = 0;
    vi.stubGlobal('fetch', async () => {
      // Only the first node fails; the second must still be replayed.
      if (call++ === 0) return { ok: false, status: 500, text: async () => 'boom' };
      return {
        json: async () => ({ choices: [{ message: { content: '42' } }] }),
        ok: true,
      };
    });

    const result = await replayTrajectory({
      concurrency: 1,
      connection,
      snapshot: twoNodeSnapshot(),
      target,
    });

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].attempt.error).toContain('500');
    expect(result.nodes[1].attempt.error).toBeUndefined();
    expect(result.nodes[1].attempt.content).toBe('42');
  });

  it('fails the verdict when the final call never reached the model', async () => {
    // A pass/fail tool that returns neither is useless: the run did not get the
    // job done, so it is a FAIL, not an absent verdict.
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, text: async () => 'down' }));

    const result = await replayTrajectory({
      connection,
      snapshot: twoNodeSnapshot(),
      target,
      verdictJudge: { judgeModel: target },
    });

    expect(result.verdict?.passed).toBe(false);
    expect(result.verdict?.score).toBe(0);
    expect(result.verdict?.reason).toContain('503');
  });

  it('settles nodes as they finish but returns them in order', async () => {
    const seen: number[] = [];
    let call = 0;
    vi.stubGlobal('fetch', async () => {
      // The first node resolves last.
      const index = call++;
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 20 : 0));
      return {
        json: async () => ({ choices: [{ message: { content: `answer ${index}` } }] }),
        ok: true,
      };
    });

    const result = await replayTrajectory({
      concurrency: 4,
      connection,
      onNode: (node) => seen.push(node.nodeIndex),
      snapshot: twoNodeSnapshot(),
      target,
    });

    // Progress arrives out of order — each node carries its own index, so a
    // renderer places it rather than appending it.
    expect(seen).toEqual([1, 0]);
    expect(result.nodes.map((node) => node.nodeIndex)).toEqual([0, 1]);
  });
});
