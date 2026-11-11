import type { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  hasRepeatedToolCall,
  hasToolCallBurst,
  TOOL_CALL_BURST_LIMIT,
  TOOL_CALL_REPEAT_LIMIT,
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
