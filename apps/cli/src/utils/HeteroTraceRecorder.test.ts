import type { ExecutionSnapshot, ISnapshotStore, SnapshotSummary } from '@lobechat/agent-tracing';
import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';
import { beforeEach, describe, expect, it } from 'vitest';

import { HeteroTraceRecorder } from './HeteroTraceRecorder';

/**
 * Round-trip through JSON rather than `structuredClone`: the real store writes
 * the partial to disk, so `undefined` fields must disappear here too. A
 * structural clone would keep them and hide a serialization bug.
 */
// eslint-disable-next-line unicorn/prefer-structured-clone
const serializeLikeDisk = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class MemoryStore implements ISnapshotStore {
  partials = new Map<string, Partial<ExecutionSnapshot>>();
  saved: ExecutionSnapshot[] = [];

  async get(traceId: string) {
    return this.saved.find((s) => s.traceId === traceId) ?? null;
  }
  async getLatest() {
    return this.saved.at(-1) ?? null;
  }
  async list(): Promise<SnapshotSummary[]> {
    return [];
  }
  async listPartials() {
    return [...this.partials.keys()].map((id) => `${id}.json`);
  }
  async loadPartial(operationId: string) {
    const partial = this.partials.get(operationId);
    // Mirror the file store: callers get a copy, not the recorder's live object.
    return partial ? serializeLikeDisk(partial) : null;
  }
  async removePartial(operationId: string) {
    this.partials.delete(operationId);
  }
  async save(snapshot: ExecutionSnapshot) {
    this.saved.push(snapshot);
  }
  async savePartial(operationId: string, partial: Partial<ExecutionSnapshot>) {
    this.partials.set(operationId, serializeLikeDisk(partial));
  }
}

const OPERATION_ID = 'op_test_1';

let clock = 1_000;
const event = (type: string, data: unknown = {}): AgentStreamEvent =>
  ({
    data,
    operationId: OPERATION_ID,
    stepIndex: 0,
    timestamp: (clock += 100),
    type,
  }) as AgentStreamEvent;

describe('HeteroTraceRecorder', () => {
  let store: MemoryStore;
  let recorder: HeteroTraceRecorder;

  beforeEach(() => {
    clock = 1000;
    store = new MemoryStore();
    recorder = new HeteroTraceRecorder({
      agentType: 'claude-code',
      operationId: OPERATION_ID,
      store,
      topicId: 'tpc_1',
    });
  });

  it('records an assistant turn as a call_llm step with usage', async () => {
    recorder.observe(event('stream_start', { model: 'claude-opus-4', provider: 'claude-code' }));
    recorder.observe(event('stream_chunk', { chunkType: 'reasoning', content: 'thinking' }));
    recorder.observe(event('stream_chunk', { chunkType: 'text', content: 'Hello' }));
    recorder.observe(event('stream_chunk', { chunkType: 'text', content: ' world' }));
    recorder.observe(
      event('step_complete', {
        model: 'claude-opus-4',
        phase: 'turn_metadata',
        usage: { totalInputTokens: 120, totalOutputTokens: 30, totalTokens: 150 },
      }),
    );
    await recorder.finalize({ result: 'success' });

    const snapshot = store.saved[0];
    expect(snapshot.steps).toHaveLength(1);
    expect(snapshot.steps[0]).toMatchObject({
      content: 'Hello world',
      inputTokens: 120,
      outputTokens: 30,
      reasoning: 'thinking',
      stepIndex: 0,
      stepType: 'call_llm',
      totalTokens: 150,
    });
    expect(snapshot.completionReason).toBe('done');
    expect(snapshot.model).toBe('claude-opus-4');
    expect(snapshot.topicId).toBe('tpc_1');
  });

  it('records a tool call as its own call_tool step and attributes it to the turn', async () => {
    recorder.observe(event('stream_start', { model: 'claude-opus-4' }));
    recorder.observe(
      event('tool_start', {
        toolCalling: {
          apiName: 'readFile',
          arguments: '{"path":"a.ts"}',
          id: 'call_1',
          identifier: 'local-system',
        },
      }),
    );
    recorder.observe(
      event('tool_result', { content: 'file body', isError: false, toolCallId: 'call_1' }),
    );
    recorder.observe(event('tool_end', { isSuccess: true, toolCallId: 'call_1' }));
    recorder.observe(event('stream_end', {}));
    await recorder.finalize({ result: 'success' });

    const snapshot = store.saved[0];
    const toolStep = snapshot.steps.find((s) => s.stepType === 'call_tool');
    const llmStep = snapshot.steps.find((s) => s.stepType === 'call_llm');

    expect(toolStep?.toolsResult).toEqual([
      { apiName: 'readFile', identifier: 'local-system', isSuccess: true, output: 'file body' },
    ]);
    // The turn that asked for the tool keeps the request; the execution is its
    // own step. Both halves have to be present to read the trace back.
    expect(llmStep?.toolsCalling).toEqual([
      { apiName: 'readFile', arguments: '{"path":"a.ts"}', identifier: 'local-system' },
    ]);
  });

  it('takes session grand totals from result_usage', async () => {
    recorder.observe(event('stream_start', {}));
    recorder.observe(
      event('step_complete', {
        phase: 'turn_metadata',
        usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
      }),
    );
    recorder.observe(
      event('step_complete', {
        costUsd: 0.42,
        phase: 'result_usage',
        usage: { totalTokens: 999 },
      }),
    );
    await recorder.finalize({ result: 'success' });

    expect(store.saved[0]).toMatchObject({ totalCost: 0.42, totalTokens: 999 });
  });

  it('falls back to per-turn tokens when the session total never arrives', async () => {
    recorder.observe(event('stream_start', {}));
    recorder.observe(
      event('step_complete', { phase: 'turn_metadata', usage: { totalTokens: 150 } }),
    );
    recorder.observe(
      event('step_complete', { phase: 'turn_metadata', usage: { totalTokens: 90 } }),
    );
    // Cancelled before `result_usage` — the only truthful number is the sum.
    await recorder.finalize({ result: 'cancelled' });

    expect(store.saved[0].totalTokens).toBe(240);
  });

  it('maps a cancelled run to interrupted and an error to error', async () => {
    recorder.observe(event('stream_start', {}));
    recorder.observe(event('stream_chunk', { chunkType: 'text', content: 'partial' }));
    await recorder.finalize({ result: 'cancelled' });
    expect(store.saved[0].completionReason).toBe('interrupted');

    const second = new HeteroTraceRecorder({ agentType: 'codex', operationId: 'op_2', store });
    second.observe(event('stream_start', {}));
    second.observe(event('stream_chunk', { chunkType: 'text', content: 'x' }));
    await second.finalize({
      error: { message: 'boom', type: 'AgentRuntimeError' },
      result: 'error',
    });
    expect(store.saved[1]).toMatchObject({
      completionReason: 'error',
      error: { message: 'boom', type: 'AgentRuntimeError' },
    });
  });

  it('keeps a partial on disk while the run is in flight, and removes it on finalize', async () => {
    recorder.observe(event('stream_start', {}));
    recorder.observe(event('stream_chunk', { chunkType: 'text', content: 'hi' }));
    recorder.observe(event('step_complete', { phase: 'turn_metadata', usage: { totalTokens: 5 } }));
    // Let the coalescing writer settle.
    await new Promise((resolve) => setImmediate(resolve));

    expect(store.partials.get(OPERATION_ID)?.steps).toHaveLength(1);

    await recorder.finalize({ result: 'success' });
    expect(store.partials.has(OPERATION_ID)).toBe(false);
  });

  it('retains notable events but not the chunk stream', async () => {
    recorder.observe(event('stream_start', {}));
    recorder.observe(event('stream_chunk', { chunkType: 'text', content: 'a' }));
    recorder.observe(event('stream_retry', { attempt: 2 }));
    await recorder.finalize({ result: 'success' });

    const events = store.saved[0].steps[0].events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ attempt: 2, type: 'stream_retry' });
  });

  it('never throws when the store fails', async () => {
    const failing = new MemoryStore();
    failing.savePartial = async () => {
      throw new Error('disk full');
    };
    const warnings: string[] = [];
    const guarded = new HeteroTraceRecorder({
      agentType: 'claude-code',
      onError: (message) => warnings.push(message),
      operationId: 'op_3',
      store: failing,
    });

    guarded.observe(event('stream_start', {}));
    guarded.observe(event('stream_chunk', { chunkType: 'text', content: 'x' }));
    await expect(guarded.finalize({ result: 'success' })).resolves.toBeUndefined();
    expect(warnings.join('\n')).toContain('disk full');
  });
});

describe('HeteroTraceRecorder empty runs', () => {
  it('writes no snapshot for a run that recorded nothing', async () => {
    const store = new MemoryStore();
    const quiet = new HeteroTraceRecorder({
      agentType: 'claude-code',
      operationId: 'op_empty',
      store,
    });

    await quiet.finalize({ result: 'success' });

    expect(store.saved).toHaveLength(0);
    expect(store.partials.has('op_empty')).toBe(false);
  });

  it('still writes a snapshot for a run that failed before producing a step', async () => {
    const store = new MemoryStore();
    const failed = new HeteroTraceRecorder({
      agentType: 'claude-code',
      operationId: 'op_never_started',
      store,
    });

    // "The CLI binary was not found" — no events at all, but the failure is
    // exactly what makes the trace worth keeping.
    await failed.finalize({
      error: { message: 'claude: command not found', type: 'AgentRuntimeError' },
      result: 'error',
    });

    expect(store.saved[0]).toMatchObject({
      completionReason: 'error',
      error: { message: 'claude: command not found' },
    });
  });
});
