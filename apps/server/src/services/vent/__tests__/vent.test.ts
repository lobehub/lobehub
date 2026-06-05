import { describe, expect, it } from 'vitest';

import { createVentService, type VentRecordInput } from '../index';

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
    const second = await service.recordVent({ ...input, toolCallId: 'tc-2' });

    expect(first.recorded).toBe(true);
    expect(second).toEqual({ recorded: false, reason: 'rate_limited' });
  });

  it('allows up to three vents per topic scope when no operation id is present', async () => {
    let counter = 0;
    const service = createVentService({ nextToolCallId: () => `tool-${++counter}` });

    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await service.recordVent(baseInput()));
    }

    expect(results.filter((r) => r.recorded)).toHaveLength(3);
    expect(results[3]).toEqual({ recorded: false, reason: 'rate_limited' });
  });
});
