import type { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { AgentState } from '../types';
import {
  getToolCallBudget,
  hasIgnoredToolCallBudget,
  hasRepeatedToolCall,
  hasToolCallBurst,
  TOOL_CALL_BUDGET_FEEDBACK_LIMIT,
  TOOL_CALL_BURST_LIMIT,
  TOOL_CALL_REPEAT_LIMIT,
  updateToolCallBudget,
  updateToolCallRepeatGuard,
} from './toolCallRepeatGuard';

const createToolCall = (argumentsValue: string): ChatToolPayload => ({
  apiName: 'inject',
  arguments: argumentsValue,
  id: 'call-1',
  identifier: 'credentials',
  type: 'default',
});

describe('toolCallRepeatGuard', () => {
  // Deliberately hardcoded (not derived from TOOL_CALL_REPEAT_LIMIT): a
  // fixed-argument polling loop — same jobId polled until the job finishes —
  // must survive well past the old limit of 5. Reverting the limit makes this
  // fail, which the self-referential tests below cannot do.
  it('lets a fixed-argument polling loop run to 19 calls and blocks the 20th', () => {
    let guard: ReturnType<typeof updateToolCallRepeatGuard> | undefined;

    for (let index = 0; index < 19; index++) {
      guard = updateToolCallRepeatGuard(guard, [createToolCall('{"jobId":"job-1"}')]);
      expect(hasRepeatedToolCall(guard)).toBe(false);
    }

    guard = updateToolCallRepeatGuard(guard, [createToolCall('{"jobId":"job-1"}')]);
    expect(hasRepeatedToolCall(guard)).toBe(true);
  });

  it('allows limit-1 consecutive calls and blocks the next with canonically equivalent arguments', () => {
    let guard: ReturnType<typeof updateToolCallRepeatGuard> | undefined;

    for (let index = 0; index < TOOL_CALL_REPEAT_LIMIT - 1; index++) {
      guard = updateToolCallRepeatGuard(guard, [
        createToolCall('{"keys":["github"],"scope":"repo"}'),
      ]);
      expect(hasRepeatedToolCall(guard)).toBe(false);
    }

    guard = updateToolCallRepeatGuard(guard, [
      createToolCall('{"scope":"repo","keys":["github"]}'),
    ]);
    expect(hasRepeatedToolCall(guard)).toBe(true);
  });

  it('resets the consecutive count when a call is absent from the next LLM turn', () => {
    const repeatedGuard = updateToolCallRepeatGuard({ counts: { previous: 4 } }, [
      createToolCall('{}'),
    ]);
    const resetGuard = updateToolCallRepeatGuard(repeatedGuard, []);

    expect(resetGuard).toEqual({ counts: {} });
    expect(hasRepeatedToolCall(resetGuard)).toBe(false);
  });

  it('counts copies of one call inside a single turn toward the limit', () => {
    const copies = (count: number) =>
      Array.from({ length: count }, () => createToolCall('{"id":"acme_ai"}'));

    expect(
      hasRepeatedToolCall(updateToolCallRepeatGuard(undefined, copies(TOOL_CALL_REPEAT_LIMIT - 1))),
    ).toBe(false);
    expect(
      hasRepeatedToolCall(updateToolCallRepeatGuard(undefined, copies(TOOL_CALL_REPEAT_LIMIT))),
    ).toBe(true);
  });

  it('adds copies in the current turn to the count carried from earlier turns', () => {
    const copies = (count: number) =>
      Array.from({ length: count }, () => createToolCall('{"id":"acme_ai"}'));
    const half = Math.ceil(TOOL_CALL_REPEAT_LIMIT / 2);

    const firstTurn = updateToolCallRepeatGuard(undefined, copies(half - 1));
    expect(hasRepeatedToolCall(updateToolCallRepeatGuard(firstTurn, copies(half - 1)))).toBe(false);
    expect(hasRepeatedToolCall(updateToolCallRepeatGuard(firstTurn, copies(half + 1)))).toBe(true);
  });

  it('flags a turn that requests more tool calls than the burst limit even with distinct arguments', () => {
    const distinct = (count: number) =>
      Array.from({ length: count }, (_, index) => createToolCall(`{"query":"topic ${index}"}`));

    expect(hasToolCallBurst(distinct(TOOL_CALL_BURST_LIMIT))).toBe(false);
    expect(hasToolCallBurst(distinct(TOOL_CALL_BURST_LIMIT + 1))).toBe(true);
    // Distinct arguments never trip the repeat count; only the burst cap catches this turn.
    expect(
      hasRepeatedToolCall(
        updateToolCallRepeatGuard(undefined, distinct(TOOL_CALL_BURST_LIMIT + 1)),
      ),
    ).toBe(false);
  });
});

describe('tool call budget', () => {
  const searchCall = (index: number): ChatToolPayload => ({
    apiName: 'search',
    arguments: `{"query":"topic ${index}"}`,
    id: `call-${index}`,
    identifier: 'memory',
    type: 'builtin',
  });

  const createState = (
    guard?: AgentState['toolCallRepeatGuard'],
    overrides?: Partial<AgentState>,
  ): AgentState =>
    ({
      toolCallRepeatGuard: guard,
      toolManifestMap: {
        files: { api: [{ name: 'read' }], identifier: 'files' },
        memory: {
          api: [{ maxCallsPerOperation: 3, name: 'search' }, { name: 'list' }],
          identifier: 'memory',
        },
      },
      ...overrides,
    }) as unknown as AgentState;

  it('reads the budget from the API entry and ignores APIs that declare none', () => {
    const state = createState();

    expect(getToolCallBudget(searchCall(0), state)).toBe(3);
    expect(getToolCallBudget({ ...searchCall(0), apiName: 'list' }, state)).toBeUndefined();
    expect(getToolCallBudget({ ...searchCall(0), identifier: 'files' }, state)).toBeUndefined();
    expect(getToolCallBudget({ ...searchCall(0), identifier: 'unknown' }, state)).toBeUndefined();
  });

  it('reads the budget of a tool that only exists as a step activation', () => {
    const state = createState(undefined, {
      activatedStepTools: [
        {
          id: 'web',
          manifest: { api: [{ maxCallsPerOperation: 5, name: 'search' }], identifier: 'web' },
        },
      ],
    } as unknown as Partial<AgentState>);

    expect(getToolCallBudget({ ...searchCall(0), identifier: 'web' }, state)).toBe(5);
  });

  it('counts calls with different arguments against one budget across turns', () => {
    let guard: AgentState['toolCallRepeatGuard'];

    for (let index = 0; index < 3; index++) {
      const update = updateToolCallBudget(createState(guard), [searchCall(index)]);
      expect(update.overBudgetCalls).toEqual([]);
      guard = { apiCalls: update.apiCalls, counts: {} };
    }

    const update = updateToolCallBudget(createState(guard), [searchCall(3)]);
    expect(update.overBudgetCalls).toEqual([{ limit: 3, toolCalling: searchCall(3) }]);
    expect(update.overBudgetRounds).toBe(1);
  });

  it('keeps the count through a turn that does not call the API', () => {
    const first = updateToolCallBudget(createState(), [searchCall(0), searchCall(1)]);
    const idle = updateToolCallBudget(createState({ apiCalls: first.apiCalls, counts: {} }), []);
    const third = updateToolCallBudget(createState({ apiCalls: idle.apiCalls, counts: {} }), [
      searchCall(2),
      searchCall(3),
    ]);

    expect(third.overBudgetCalls.map(({ toolCalling }) => toolCalling.id)).toEqual(['call-3']);
  });

  it('flags only the calls past the budget inside one turn, in emission order', () => {
    const update = updateToolCallBudget(
      createState(),
      Array.from({ length: 5 }, (_, index) => searchCall(index)),
    );

    expect(update.overBudgetCalls.map(({ toolCalling }) => toolCalling.id)).toEqual([
      'call-3',
      'call-4',
    ]);
  });

  it('counts consecutive over-budget turns and starts over once a turn stays within budget', () => {
    const exhausted = { apiCalls: { '["memory","search"]': 3 }, counts: {} };

    const second = updateToolCallBudget(createState({ ...exhausted, overBudgetRounds: 1 }), [
      searchCall(9),
    ]);
    expect(second.overBudgetRounds).toBe(2);

    const movedOn = updateToolCallBudget(createState({ ...exhausted, overBudgetRounds: 2 }), [
      { ...searchCall(9), identifier: 'files', apiName: 'read' },
    ]);
    expect(movedOn.overBudgetRounds).toBe(0);
    expect(movedOn.apiCalls).toEqual(exhausted.apiCalls);
  });

  it('tolerates the feedback limit of rejected turns and stops on the next', () => {
    expect(hasIgnoredToolCallBudget(TOOL_CALL_BUDGET_FEEDBACK_LIMIT)).toBe(false);
    expect(hasIgnoredToolCallBudget(TOOL_CALL_BUDGET_FEEDBACK_LIMIT + 1)).toBe(true);
  });
});
