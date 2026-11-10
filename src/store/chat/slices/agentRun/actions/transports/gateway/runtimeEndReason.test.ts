import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  findTerminalAssistantError,
  isCompletedRuntimeEnd,
  resolveRuntimeEndStatus,
} from './runtimeEndReason';

describe('runtimeEndReason', () => {
  it.each([
    ['completed', 'completed'],
    ['done', 'completed'],
    ['success', 'completed'],
    [undefined, 'completed'],
    ['error', 'failed'],
    ['cancelled', 'cancelled'],
    ['interrupted', 'cancelled'],
    ['waiting_for_async_tool', 'cancelled'],
  ])('settles reason %s as %s', (reason, status) => {
    expect(resolveRuntimeEndStatus(reason)).toBe(status);
    expect(isCompletedRuntimeEnd(reason)).toBe(status === 'completed');
  });

  it('reads the error from the last step of a grouped hetero run', () => {
    const error = { message: 'boom', type: 'AgentRuntimeError' };
    const messages = [
      { content: 'hi', id: 'u', role: 'user' },
      {
        children: [{ id: 'a1' }, { error, id: 'a2' }],
        content: '...',
        id: 'a1',
        role: 'assistantGroup',
      },
    ] as unknown as UIChatMessage[];

    expect(findTerminalAssistantError(messages)).toBe(error);
  });

  it('reads the error from a plain assistant row and ignores null', () => {
    const error = { message: 'boom', type: 'AgentRuntimeError' };

    expect(
      findTerminalAssistantError([{ error, id: 'a', role: 'assistant' }] as UIChatMessage[]),
    ).toBe(error);
    expect(
      findTerminalAssistantError([{ error: null, id: 'a', role: 'assistant' }] as UIChatMessage[]),
    ).toBeUndefined();
    expect(findTerminalAssistantError(undefined)).toBeUndefined();
  });
});
