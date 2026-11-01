import { describe, expect, it, vi } from 'vitest';

import { MCPClient } from '../client';

/**
 * Focused test for the bounded stderr tail: only the stderr listener
 * wiring is exercised through a stubbed transport — no real stdio process
 * is spawned (the SDK Client/transport created in the constructor are
 * never connected).
 */
describe('MCPClient stderr tail cap (P2: bounded memory for pooled clients)', () => {
  it('keeps only the most recent 200 stderr lines', () => {
    const client = new MCPClient({
      args: [],
      command: 'verbose-mcp',
      name: 'verbose',
      type: 'stdio',
    });

    const listeners = new Map<string, (chunk: Buffer) => void>();
    const transport = {
      stderr: {
        on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
          listeners.set(event, handler);
        }),
      },
    };
    const emit = (chunk: Buffer) => listeners.get('data')?.(chunk);

    (client as any).setupStderrListener(transport as any);

    // Push 450 lines across batches; retention must cap at 200 (the tail).
    for (let batch = 0; batch < 45; batch++) {
      const lines = Array.from({ length: 10 }, (_, k) => `line-${batch * 10 + k}`);
      emit(Buffer.from(lines.join('\n')));
    }

    const logs = client.getStderrLogs();
    expect(logs.length).toBe(200);
    expect(logs[0]).toBe('line-250');
    expect(logs[199]).toBe('line-449');
  });
});
