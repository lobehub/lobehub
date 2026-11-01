import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProbeShardController } from './probeShards';

describe('bounded probe shards', () => {
  afterEach(() => vi.useRealTimers());

  it('splits work without discarding or duplicating planned probes', () => {
    const controller = createProbeShardController({ budget: { maxProbesPerShard: 2 } });
    const assignments = ['a', 'b', 'c'].map((id) => {
      const assignment = controller.beginProbe(id, 'normal');
      controller.completeProbe(id);
      return assignment;
    });
    const report = controller.report(['a', 'b', 'c']);
    expect(assignments.map((entry) => entry?.newShard)).toEqual([true, false, true]);
    expect(report.shards.map((shard) => shard.completedProbeIds)).toEqual([['a', 'b'], ['c']]);
    expect(report.unexecutedProbeIds).toEqual([]);
    expect(report.gaps).toEqual([]);
    expect(report.gateEligible).toBe(false);
  });

  it('starts a fresh shard at a variant boundary', () => {
    const controller = createProbeShardController();
    const first = controller.beginProbe('a', 'normal');
    controller.completeProbe('a');
    const second = controller.beginProbe('b', 'loading');
    controller.completeProbe('b');
    expect(second?.newShard).toBe(true);
    expect(second?.shardId).not.toBe(first?.shardId);
    expect(controller.report(['a', 'b']).shards.map((entry) => entry.variant)).toEqual([
      'normal',
      'loading',
    ]);
  });

  it('rolls over before the time reserve is consumed', () => {
    let now = 0;
    const controller = createProbeShardController({ clock: () => now });
    controller.beginProbe('a', 'normal');
    now = 28_000;
    controller.completeProbe('a');
    expect(controller.beginProbe('b', 'normal')?.newShard).toBe(true);
    controller.completeProbe('b');
    expect(controller.report(['a', 'b']).gaps).toEqual([]);
  });

  it('retains unfinished work when the shard count is exhausted', () => {
    const controller = createProbeShardController({
      budget: { maxProbesPerShard: 1, maxShards: 1 },
    });
    controller.beginProbe('a', 'normal');
    controller.completeProbe('a');
    expect(controller.beginProbe('b', 'normal')).toBeUndefined();
    const report = controller.report(['a', 'b', 'c']);
    expect(report.unexecutedProbeIds).toEqual(['b', 'c']);
    expect(report.gaps).toContain('PROBE_SHARD_COUNT_BUDGET_EXCEEDED');
  });

  it('bounds the whole execution, not just each shard', () => {
    let now = 0;
    const controller = createProbeShardController({
      budget: { maxRunDurationMs: 4000, probeReserveMs: 100 },
      clock: () => now,
    });
    controller.beginProbe('a', 'normal');
    controller.completeProbe('a');
    now = 3900;
    expect(controller.beginProbe('b', 'loading')).toBeUndefined();
    expect(controller.report(['a', 'b']).gaps).toContain('PROBE_RUN_TIME_BUDGET_EXCEEDED');
  });

  it('never hides an over-budget completed shard', () => {
    let now = 0;
    const controller = createProbeShardController({ clock: () => now });
    controller.beginProbe('a', 'normal');
    now = 30_001;
    controller.completeProbe('a');
    const report = controller.report(['a']);
    expect(report.shards[0].status).toBe('BUDGET_EXCEEDED');
    expect(report.gaps).toContain('PROBE_SHARD_TIME_BUDGET_EXCEEDED');
  });

  it('retains a whole-run overrun even when the final probe completed', () => {
    let now = 0;
    const controller = createProbeShardController({
      budget: { maxRunDurationMs: 4000, probeReserveMs: 100 },
      clock: () => now,
    });
    controller.beginProbe('a', 'normal');
    now = 4001;
    controller.completeProbe('a');
    expect(controller.report(['a']).gaps).toContain('PROBE_RUN_TIME_BUDGET_EXCEEDED');
  });

  it('records an interrupted probe as incomplete and does not retry it', () => {
    const controller = createProbeShardController();
    controller.beginProbe('a', 'normal');
    const report = controller.report(['a', 'b']);
    expect(report.shards[0].status).toBe('ERROR');
    expect(report.unexecutedProbeIds).toEqual(['a', 'b']);
    expect(report.gaps).toContain('PROBE_SHARD_INCOMPLETE');
    expect(() => controller.beginProbe('a', 'normal')).toThrow('DUPLICATE_PROBE_EXECUTION');
  });

  it('bounds each browser operation by the current shard deadline', () => {
    let now = 0;
    const controller = createProbeShardController({ clock: () => now });
    controller.beginProbe('a', 'normal');
    now = 2000;
    expect(controller.remaining()).toBe(28_000);
    now = 30_000;
    expect(() => controller.remaining()).toThrow('PROBE_SHARD_TIME_BUDGET_EXCEEDED');
  });

  it('also bounds each browser operation by the whole-run deadline', () => {
    let now = 0;
    const controller = createProbeShardController({
      budget: { maxRunDurationMs: 4000, probeReserveMs: 100 },
      clock: () => now,
    });
    controller.beginProbe('a', 'normal');
    now = 1000;
    expect(controller.remaining()).toBe(3000);
  });

  it('does not start a browser operation after its deadline', async () => {
    let now = 0;
    const controller = createProbeShardController({ clock: () => now });
    controller.beginProbe('a', 'normal');
    now = 30_000;
    const operation = vi.fn(async () => 42);
    await expect(controller.runOperation(operation)).rejects.toThrow(
      'PROBE_SHARD_TIME_BUDGET_EXCEEDED',
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('fails a hung operation and keeps the unfinished probe', async () => {
    vi.useFakeTimers();
    const controller = createProbeShardController({
      budget: { maxShardDurationMs: 1000, probeReserveMs: 0 },
      clock: () => 0,
    });
    controller.beginProbe('a', 'normal');
    const failure = expect(
      controller.runOperation(() => new Promise<never>(() => {})),
    ).rejects.toThrow('BROWSER_OPERATION_TIMEOUT');
    await vi.advanceTimersByTimeAsync(1000);
    await failure;
    const report = controller.report(['a']);
    expect(report.shards[0].status).toBe('ERROR');
    expect(report.unexecutedProbeIds).toEqual(['a']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans operation timers on success and on synchronous failure', async () => {
    vi.useFakeTimers();
    const controller = createProbeShardController({ clock: () => 0 });
    controller.beginProbe('a', 'normal');
    await expect(controller.runOperation(async () => 42)).resolves.toBe(42);
    await expect(
      controller.runOperation(() => {
        throw new Error('BROKEN_OPERATION');
      }),
    ).rejects.toThrow('BROKEN_OPERATION');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a completed difference independent of missing later probes', () => {
    const controller = createProbeShardController({
      budget: { maxProbesPerShard: 1, maxShards: 1 },
    });
    controller.beginProbe('difference', 'normal');
    controller.completeProbe('difference');
    controller.beginProbe('not-run', 'normal');
    const report = controller.report(['difference', 'not-run']);
    expect(report.shards[0].completedProbeIds).toEqual(['difference']);
    expect(report.unexecutedProbeIds).toEqual(['not-run']);
  });

  it('rejects mismatched completion, overlapping work and duplicate planned IDs', () => {
    const controller = createProbeShardController();
    controller.beginProbe('a', 'normal');
    expect(() => controller.completeProbe('b')).toThrow('PROBE_COMPLETION_MISMATCH');
    expect(() => controller.beginProbe('b', 'normal')).toThrow('PROBE_ALREADY_RUNNING');
    controller.completeProbe('a');
    expect(() => controller.report(['a', 'a'])).toThrow('DUPLICATE_PLANNED_PROBE');
    expect(() => controller.report(['b'])).toThrow('EXECUTED_PROBE_NOT_PLANNED');
  });

  it.each([
    { maxProbesPerShard: 65 },
    { maxShards: 17 },
    { maxShardDurationMs: 30_001 },
    { maxRunDurationMs: 900_001 },
    { maxProbesPerShard: 0 },
    { maxShards: 1.5 },
    { maxShardDurationMs: 1000 },
    { maxShards: Number.NaN },
  ])('rejects invalid or expanded diagnostic budgets: %j', (budget) => {
    expect(() => createProbeShardController({ budget })).toThrow('INVALID_PROBE_SHARD_BUDGET');
  });
});
