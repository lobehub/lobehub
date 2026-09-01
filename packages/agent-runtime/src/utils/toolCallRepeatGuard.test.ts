import type { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  hasRepeatedToolCall,
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
});
