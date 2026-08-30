import { ClaudeCodeAdapter } from '@lobechat/heterogeneous-agents';
import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';
import { describe, expect, it } from 'vitest';

import { HeteroTraceRecorder } from './HeteroTraceRecorder';
import type { ExecutionSnapshot, ISnapshotStore, SnapshotSummary } from '@lobechat/agent-tracing';

/**
 * Drives the REAL Claude Code adapter, so the recorder is validated against the
 * event stream the adapter actually emits rather than a hand-written imitation
 * of it. A change to the adapter's event shapes should break this test.
 */
class MemoryStore implements ISnapshotStore {
  partials = new Map<string, Partial<ExecutionSnapshot>>();
  saved: ExecutionSnapshot[] = [];

  async get() {
    return null;
  }
  async getLatest() {
    return null;
  }
  async list(): Promise<SnapshotSummary[]> {
    return [];
  }
  async listPartials() {
    return [];
  }
  async loadPartial(operationId: string) {
    return this.partials.get(operationId) ?? null;
  }
  async removePartial(operationId: string) {
    this.partials.delete(operationId);
  }
  async save(snapshot: ExecutionSnapshot) {
    this.saved.push(snapshot);
  }
  async savePartial(operationId: string, partial: Partial<ExecutionSnapshot>) {
    this.partials.set(operationId, partial);
  }
}

/** A batch-mode Claude Code session: text, one tool call, an answer, a result. */
const RAW_SESSION: unknown[] = [
  { model: 'claude-opus-4-8', session_id: 'sess_1', subtype: 'init', type: 'system' },
  {
    message: {
      content: [{ text: 'Let me read that file.', type: 'text' }],
      id: 'msg_1',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 100, output_tokens: 12 },
    },
    type: 'assistant',
  },
  {
    message: {
      content: [
        { id: 'toolu_1', input: { file_path: '/tmp/a.ts' }, name: 'Read', type: 'tool_use' },
      ],
      id: 'msg_2',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 150, output_tokens: 30 },
    },
    type: 'assistant',
  },
  {
    message: {
      content: [
        { content: 'export const a = 1;', is_error: false, tool_use_id: 'toolu_1', type: 'tool_result' },
      ],
    },
    type: 'user',
  },
  {
    message: {
      content: [{ text: 'The file exports `a`.', type: 'text' }],
      id: 'msg_3',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 200, output_tokens: 20 },
    },
    type: 'assistant',
  },
  {
    result: 'done',
    subtype: 'success',
    total_cost_usd: 0.031,
    type: 'result',
    usage: { input_tokens: 450, output_tokens: 62 },
  },
];

const runAdapter = (recorder: HeteroTraceRecorder) => {
  const adapter = new ClaudeCodeAdapter();
  let timestamp = 1_000;

  for (const raw of RAW_SESSION) {
    for (const event of adapter.adapt(raw as never)) {
      recorder.observe({
        ...event,
        operationId: 'op_adapter',
        timestamp: (timestamp += 100),
      } as AgentStreamEvent);
    }
  }
};

describe('HeteroTraceRecorder against the real ClaudeCodeAdapter', () => {
  it('segments a session into per-turn LLM steps and per-call tool steps', async () => {
    const store = new MemoryStore();
    const recorder = new HeteroTraceRecorder({
      agentType: 'claude-code',
      operationId: 'op_adapter',
      store,
      topicId: 'tpc_adapter',
    });

    runAdapter(recorder);
    await recorder.finalize({ result: 'success' });

    const snapshot = store.saved[0];
    expect(snapshot).toBeDefined();

    // Three assistant turns → three call_llm steps; one tool call → one call_tool.
    const llmSteps = snapshot.steps.filter((s) => s.stepType === 'call_llm');
    const toolSteps = snapshot.steps.filter((s) => s.stepType === 'call_tool');
    expect(llmSteps).toHaveLength(3);
    expect(toolSteps).toHaveLength(1);

    // Step indices are contiguous and chronological.
    expect(snapshot.steps.map((s) => s.stepIndex)).toEqual([0, 1, 2, 3]);

    // The turn that asked for the tool records the request. Note the adapter's
    // convention: `identifier` is the wrapping CLI agent, `apiName` the tool it
    // called — not the other way round.
    expect(llmSteps[1].toolsCalling).toEqual([
      {
        apiName: 'Read',
        arguments: JSON.stringify({ file_path: '/tmp/a.ts' }),
        identifier: 'claude-code',
      },
    ]);
    // …and the tool step records the outcome.
    expect(toolSteps[0].toolsResult?.[0]).toMatchObject({
      apiName: 'Read',
      identifier: 'claude-code',
      isSuccess: true,
      output: 'export const a = 1;',
    });

    // Per-turn usage lands on the right step.
    expect(llmSteps[0]).toMatchObject({ content: 'Let me read that file.', inputTokens: 100 });
    expect(llmSteps[2]).toMatchObject({ content: 'The file exports `a`.', inputTokens: 200 });

    // Session grand totals come from the result event, not the sum of turns.
    expect(snapshot.totalCost).toBe(0.031);
    expect(snapshot.totalTokens).toBe(512);
    expect(snapshot.model).toBe('claude-opus-4-8');
    expect(snapshot.completionReason).toBe('done');
  });

  it('leaves a resumable partial behind when the process dies mid-session', async () => {
    const store = new MemoryStore();
    const recorder = new HeteroTraceRecorder({
      agentType: 'claude-code',
      operationId: 'op_killed',
      store,
    });

    const adapter = new ClaudeCodeAdapter();
    let timestamp = 1_000;
    // Everything up to (but not including) the result event — i.e. the process
    // was killed before it could finalize.
    for (const raw of RAW_SESSION.slice(0, -1)) {
      for (const event of adapter.adapt(raw as never)) {
        recorder.observe({
          ...event,
          operationId: 'op_killed',
          timestamp: (timestamp += 100),
        } as AgentStreamEvent);
      }
    }
    await new Promise((resolve) => setImmediate(resolve));

    // No completed snapshot, but the work so far survives on disk.
    expect(store.saved).toHaveLength(0);
    const partial = store.partials.get('op_killed');
    expect(partial?.steps?.length).toBeGreaterThan(0);
    expect(partial?.operationId).toBe('op_killed');
  });
});
