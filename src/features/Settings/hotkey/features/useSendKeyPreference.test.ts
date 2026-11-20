/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSendKeyPreference } from './useSendKeyPreference';

const mocks = vi.hoisted(() => ({
  preference: {} as { useCmdEnterToSend?: boolean },
  updatePreference: vi.fn(),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ preference: mocks.preference, updatePreference: mocks.updatePreference }),
}));

describe('useSendKeyPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preference = {};
  });

  it('defaults to Enter when the preference was never set', () => {
    const { result } = renderHook(() => useSendKeyPreference());

    expect(result.current.sendKey).toBe('enter');
  });

  it('reflects a saved Cmd/Ctrl+Enter preference', () => {
    mocks.preference = { useCmdEnterToSend: true };
    const { result } = renderHook(() => useSendKeyPreference());

    expect(result.current.sendKey).toBe('modEnter');
  });

  it.each([
    ['modEnter', true],
    ['enter', false],
  ] as const)('saves %s as useCmdEnterToSend=%s', (sendKey, expected) => {
    const { result } = renderHook(() => useSendKeyPreference());

    result.current.setSendKey(sendKey);

    expect(mocks.updatePreference).toHaveBeenCalledWith({ useCmdEnterToSend: expected });
  });
});
