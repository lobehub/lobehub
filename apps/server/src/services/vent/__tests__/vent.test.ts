import { describe, expect, it, vi } from 'vitest';

import {
  createRedisVentLedger,
  createVentService,
  formatVentResultContent,
  type VentRecordInput,
  type VentRedisClient,
} from '../index';

/** Runs the admit script's semantics against an in-memory set store. */
const createFakeRedis = (): VentRedisClient & { sets: Map<string, Set<string>> } => {
  const sets = new Map<string, Set<string>>();
  return {
    eval: async (_script, _numKeys, key, member, limit) => {
      const set = sets.get(String(key)) ?? new Set<string>();
      if (set.has(String(member))) return 'duplicate';
      if (set.size >= Number(limit)) return 'rate_limited';
      set.add(String(member));
      sets.set(String(key), set);
      return 'accepted';
    },
    sets,
  };
};

const baseInput = (overrides: Partial<VentRecordInput> = {}): VentRecordInput => ({
  agentId: 'agent-1',
  input: {
    category: 'platform_bug',
    details: 'The run-command tool returned a 500 twice in a row.',
    severity: 'high',
    summary: 'run-command crashes on valid input.',
  },
  topicId: 'topic-1',
  userId: 'user-1',
  ...overrides,
});

describe('createVentService', () => {
  it('accepts a valid vent and returns a stable vent id', async () => {
    const service = createVentService({ nextToolCallId: () => 'tool-1' });

    const result = await service.recordVent(baseInput());

    expect(result.recorded).toBe(true);
    expect(result.ventId).toBe('vent:user-1:agent-1:topic:topic-1:tool-1');
  });

  it('generates a tool-call id when the caller does not provide one', async () => {
    const service = createVentService({ nextToolCallId: () => 'generated-1' });

    const result = await service.recordVent(baseInput());

    expect(result.ventId).toBe('vent:user-1:agent-1:topic:topic-1:generated-1');
  });

  it('rejects invalid category and severity', async () => {
    const service = createVentService({ nextToolCallId: () => 'tool-1' });

    const badCategory = await service.recordVent(
      baseInput({ input: { ...baseInput().input, category: 'nope' as never } }),
    );
    const badSeverity = await service.recordVent(
      baseInput({ input: { ...baseInput().input, severity: 'urgent' as never } }),
    );

    expect(badCategory).toEqual({ recorded: false, reason: 'invalid_category' });
    expect(badSeverity).toEqual({ recorded: false, reason: 'invalid_severity' });
  });

  it('allows only one vent per operation scope', async () => {
    const service = createVentService({ nextToolCallId: () => 'tool-1' });
    const input = baseInput({ operationId: 'op-1', toolCallId: 'tc-1' });

    const first = await service.recordVent(input);
    const second = await service.recordVent({
      ...input,
      input: { ...input.input, summary: 'Another complaint.' },
      toolCallId: 'tc-2',
    });

    expect(first.recorded).toBe(true);
    expect(second).toEqual({ recorded: false, reason: 'rate_limited' });
  });

  it('allows up to three vents per topic scope when no operation id is present', async () => {
    let counter = 0;
    const service = createVentService({ nextToolCallId: () => `tool-${++counter}` });

    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(
        await service.recordVent(
          baseInput({ input: { ...baseInput().input, summary: `complaint ${i}` } }),
        ),
      );
    }

    expect(results.filter((r) => r.recorded)).toHaveLength(3);
    expect(results[3]).toEqual({ recorded: false, reason: 'rate_limited' });
  });
});

describe('vent ledger across instances', () => {
  // Consecutive steps of one server run can execute on different instances.
  // A per-instance count let several operations record more than one vent.
  it('holds the per-run cap when two instances share the Redis ledger', async () => {
    const redis = createFakeRedis();
    const instanceA = createVentService({
      ledger: createRedisVentLedger(redis),
      nextToolCallId: () => 'a',
    });
    const instanceB = createVentService({
      ledger: createRedisVentLedger(redis),
      nextToolCallId: () => 'b',
    });
    const input = baseInput({ operationId: 'op-1' });

    const first = await instanceA.recordVent(input);
    const second = await instanceB.recordVent({
      ...input,
      input: { ...input.input, summary: 'A different complaint.' },
    });
    const repeat = await instanceB.recordVent(input);

    expect(first.recorded).toBe(true);
    expect(second).toEqual({ recorded: false, reason: 'rate_limited' });
    expect(repeat).toEqual({ recorded: false, reason: 'duplicate' });
    expect([...redis.sets.keys()]).toEqual(['vent:ledger:user-1:agent-1:operation:op-1']);
  });

  it('falls back to the memory ledger when Redis fails', async () => {
    const service = createVentService({
      ledger: createRedisVentLedger({
        eval: async () => {
          throw new Error('down');
        },
      }),
      nextToolCallId: () => 'tool-1',
    });
    const input = baseInput({ operationId: 'op-1' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await service.recordVent(input)).recorded).toBe(true);
    expect(await service.recordVent(input)).toEqual({ recorded: false, reason: 'duplicate' });
    errorSpy.mockRestore();
  });

  it('rejects an empty report before it reaches the ledger', async () => {
    const redis = createFakeRedis();
    const service = createVentService({
      ledger: createRedisVentLedger(redis),
      nextToolCallId: () => 'tool-1',
    });

    const result = await service.recordVent(
      baseInput({ input: { ...baseInput().input, details: '', summary: ' ' } }),
    );

    expect(result).toEqual({ recorded: false, reason: 'empty_content' });
    expect(redis.sets.size).toBe(0);
  });
});

describe('formatVentResultContent', () => {
  it('renders a readable confirmation instead of raw JSON when recorded', () => {
    const content = formatVentResultContent({
      category: 'missing_tool',
      reason: null,
      recorded: true,
      severity: 'high',
      ventId: 'vent:user-1:agent-1:topic:topic-1:tool-1',
    });

    expect(content).toBe(
      'Vent recorded (high missing_tool), id vent:user-1:agent-1:topic:topic-1:tool-1. The friction report has been filed for the platform team. It does not end your turn or change anything — continue your task, and do not vent again in this run.',
    );
    expect(() => JSON.parse(content)).toThrow();
  });

  it('explains each rejection reason in plain text', () => {
    expect(formatVentResultContent({ reason: 'rate_limited', recorded: false })).toContain(
      'this run already filed its vent',
    );
    expect(formatVentResultContent({ reason: 'invalid_category', recorded: false })).toContain(
      'Valid categories: missing_tool',
    );
    expect(formatVentResultContent({ reason: 'invalid_severity', recorded: false })).toContain(
      'Valid severities: low, medium, high',
    );
    expect(formatVentResultContent({ reason: 'missing_context', recorded: false })).toContain(
      'context is missing',
    );
  });
});
