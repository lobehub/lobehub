import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { ExecutionSnapshot, ISnapshotStore } from '@lobechat/agent-tracing';
import { beforeEach, describe, expect, it } from 'vitest';

import { HeteroTraceRecorder } from '../HeteroTraceRecorder';

/** Minimal in-memory snapshot store for folding assertions. */
class FakeSnapshotStore implements ISnapshotStore {
  partials = new Map<string, Partial<ExecutionSnapshot>>();
  saved = new Map<string, ExecutionSnapshot>();

  async loadPartial(operationId: string) {
    const p = this.partials.get(operationId);
    // return a deep clone so the recorder mutating the loaded object doesn't
    // accidentally short-circuit the persist round-trip we want to exercise.
    return p ? (JSON.parse(JSON.stringify(p)) as Partial<ExecutionSnapshot>) : null;
  }
  async savePartial(operationId: string, partial: Partial<ExecutionSnapshot>) {
    this.partials.set(operationId, partial);
  }
  async removePartial(operationId: string) {
    this.partials.delete(operationId);
  }
  async save(snapshot: ExecutionSnapshot) {
    this.saved.set(snapshot.operationId, snapshot);
  }
  async get() {
    return null;
  }
  async getLatest() {
    return null;
  }
  async list() {
    return [];
  }
  async listPartials() {
    return [...this.partials.keys()];
  }
}

const ev = (
  type: AgentStreamEvent['type'],
  stepIndex: number,
  timestamp: number,
  data: Record<string, unknown>,
): AgentStreamEvent => ({ data, operationId: 'op-1', stepIndex, timestamp, type });

describe('HeteroTraceRecorder', () => {
  let store: FakeSnapshotStore;
  let recorder: HeteroTraceRecorder;

  beforeEach(() => {
    store = new FakeSnapshotStore();
    recorder = new HeteroTraceRecorder(store);
  });

  it('is disabled and no-ops when the store is null', async () => {
    const disabled = new HeteroTraceRecorder(null);
    expect(disabled.enabled).toBe(false);
    await disabled.appendBatch('op-1', [
      ev('stream_chunk', 0, 1, { chunkType: 'text', content: 'x' }),
    ]);
    expect(await disabled.finalize('op-1', { completionReason: 'done' })).toBeNull();
  });

  it('folds events into per-stepIndex steps and finalizes an ExecutionSnapshot', async () => {
    // Batch 1: header + step 0 text + a tool call
    await recorder.appendBatch('op-1', [
      ev('stream_start', 0, 100, {
        assistantMessage: { id: 'm' },
        model: 'sonnet',
        provider: 'anthropic',
      }),
      ev('stream_chunk', 0, 110, { chunkType: 'text', content: 'Hello ' }),
      ev('stream_chunk', 0, 120, { chunkType: 'reasoning', reasoning: 'think' }),
      ev('stream_chunk', 0, 130, {
        chunkType: 'tools_calling',
        toolsCalling: [{ apiName: 'Bash', arguments: '{"cmd":"ls"}', identifier: 'claude-code' }],
      }),
    ]);
    // Batch 2: step 0 tool_end + usage, then a pure-text step 1 (accumulates across batches)
    await recorder.appendBatch('op-1', [
      ev('tool_end', 0, 140, {
        isSuccess: true,
        toolCalling: { apiName: 'Bash', identifier: 'claude-code' },
      }),
      ev('step_complete', 0, 150, {
        phase: 'turn_metadata',
        usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
      }),
      ev('stream_chunk', 1, 200, { chunkType: 'text', content: 'done' }),
      ev('step_complete', 1, 205, { phase: 'turn_metadata', usage: { totalTokens: 8 } }),
      // Final result_usage carries the authoritative SESSION total (25) — which
      // is deliberately NOT the sum of the per-turn steps (15 + 8 = 23), proving
      // finalize prefers it and does not double-count.
      ev('step_complete', 1, 210, {
        costUsd: 0.002,
        phase: 'result_usage',
        usage: { totalInputTokens: 12, totalOutputTokens: 13, totalTokens: 25 },
      }),
    ]);

    const totals = await recorder.finalize('op-1', {
      agentId: 'agent-1',
      completionReason: 'done',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(totals).toMatchObject({
      llmCalls: 1,
      // resolved from stream_start, so heteroFinish can backfill the op row
      model: 'sonnet',
      provider: 'anthropic',
      stepCount: 2,
      toolCalls: 1,
      totalInputTokens: 12,
      totalOutputTokens: 13,
      totalTokens: 25, // session total, not the 23 step sum
    });
    expect(totals!.totalCost).toBeCloseTo(0.002);
    expect(totals!.traceS3Key).toBe('agent-traces/agent-1/topic-1/op-1.json.zst');

    const snap = store.saved.get('op-1')!;
    expect(snap).toBeDefined();
    expect(snap).toMatchObject({
      agentId: 'agent-1',
      completionReason: 'done',
      model: 'sonnet',
      operationId: 'op-1',
      provider: 'anthropic',
      topicId: 'topic-1',
      totalSteps: 2,
      totalTokens: 25, // session total
      traceId: 'op-1',
      userId: 'user-1',
    });
    expect(snap.totalCost).toBeCloseTo(0.002);

    const [step0, step1] = snap.steps;
    expect(step0.stepIndex).toBe(0);
    expect(step0.stepType).toBe('call_tool'); // had a tool call
    expect(step0.content).toBe('Hello ');
    expect(step0.reasoning).toBe('think');
    expect(step0.toolsCalling).toEqual([
      { apiName: 'Bash', arguments: '{"cmd":"ls"}', identifier: 'claude-code' },
    ]);
    expect(step0.toolsResult?.[0]).toMatchObject({ apiName: 'Bash', isSuccess: true });
    expect(step0.inputTokens).toBe(10);
    expect(step0.outputTokens).toBe(5);
    expect(step0.totalTokens).toBe(15);
    expect(step0.executionTimeMs).toBe(50); // 150 - 100

    expect(step1.stepIndex).toBe(1);
    expect(step1.stepType).toBe('call_llm'); // pure text
    expect(step1.content).toBe('done');
    expect(step1.totalTokens).toBe(8); // its own turn_metadata, NOT the session total
    expect(step1.totalCost).toBe(0); // result_usage cost is a session total, not folded per-step

    // context-engine is never populated for hetero steps
    expect(step0.contextEngine).toBeUndefined();
    expect(step1.contextEngine).toBeUndefined();

    // partial cleaned up after finalize
    expect(store.partials.has('op-1')).toBe(false);
  });

  it('returns null from finalize when no partial was accumulated', async () => {
    expect(await recorder.finalize('never-seen', { completionReason: 'done' })).toBeNull();
  });
});
