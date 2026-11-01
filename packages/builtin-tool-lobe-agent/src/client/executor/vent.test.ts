import type { BuiltinToolContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { VentParams } from '../../types';
import { lobeAgentExecutor } from './index';

vi.mock('@/services/notebook', () => ({ notebookService: {} }));
vi.mock('@/store/notebook', () => ({ useNotebookStore: { getState: () => ({}) } }));

const vent = (overrides: Partial<VentParams> = {}): VentParams => ({
  category: 'other',
  details: 'Output the SVG timing diagram directly',
  severity: 'low',
  summary: 'Stop',
  ...overrides,
});

let callSeq = 0;
const createContext = (rootOperationId: string): BuiltinToolContext => {
  callSeq += 1;
  // Each client tool call runs under its own child operation; the run is the root.
  return {
    messageId: `tool-msg-${callSeq}`,
    operationId: `op_tool_${callSeq}`,
    rootOperationId,
    toolCallId: `call_${callSeq}`,
    topicId: 'tpc_1',
  };
};

describe('lobeAgentExecutor.vent', () => {
  // A client run once called vent 133 times in a row to "stop the tool loop":
  // every call was recorded and answered with the same success line, so the
  // model never learned the call did nothing.
  it('records only the first vent of a run, whatever each tool call operation is', async () => {
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(
        await lobeAgentExecutor.vent(vent({ summary: `Stop ${i}` }), createContext('op_run_a')),
      );
    }

    expect(results.map((r) => r.state?.recorded)).toEqual([true, false, false, false, false]);
    expect(results[1].state).toMatchObject({ reason: 'rate_limited', ventId: null });
    expect(results[1].content).toContain('Do not call vent again in this run');
    expect(results[1].content).toContain('does not stop, end, or reset anything');
  });

  it('flags a repeated report as a duplicate', async () => {
    await lobeAgentExecutor.vent(vent(), createContext('op_run_b'));
    const repeat = await lobeAgentExecutor.vent(
      vent({ details: '  output the SVG timing   diagram directly ', summary: 'STOP' }),
      createContext('op_run_b'),
    );

    expect(repeat.state).toMatchObject({ reason: 'duplicate', recorded: false });
    expect(repeat.content).toContain('same report was already filed');
  });

  it('rejects an empty vent without spending the run allowance', async () => {
    const empty = await lobeAgentExecutor.vent(
      vent({ details: ' ', summary: '' }),
      createContext('op_run_c'),
    );
    const real = await lobeAgentExecutor.vent(vent(), createContext('op_run_c'));

    expect(empty.state).toMatchObject({ reason: 'empty_content', recorded: false });
    expect(empty.content).toContain('summary and details are empty');
    expect(real.state?.recorded).toBe(true);
  });

  it('gives each run its own allowance', async () => {
    const first = await lobeAgentExecutor.vent(vent(), createContext('op_run_d'));
    const second = await lobeAgentExecutor.vent(vent(), createContext('op_run_e'));

    expect(first.state?.recorded).toBe(true);
    expect(second.state?.recorded).toBe(true);
    expect(first.content).toContain('It does not end your turn');
  });

  it('still reports an unknown category as invalid arguments', async () => {
    const result = await lobeAgentExecutor.vent(
      vent({ category: 'nope' as never }),
      createContext('op_run_f'),
    );

    expect(result.success).toBe(false);
    expect(result.state).toEqual({ reason: 'invalid_category', recorded: false });
  });
});
