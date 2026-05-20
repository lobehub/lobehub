import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { __resetFloatingChatPanelRegistry, useSingleInstanceGuard } from './guard';

describe('useSingleInstanceGuard', () => {
  beforeEach(() => {
    __resetFloatingChatPanelRegistry();
  });

  it('allows a single instance to mount without throwing', () => {
    expect(() => renderHook(() => useSingleInstanceGuard())).not.toThrow();
  });

  it('throws when a second instance mounts while the first is alive', () => {
    const first = renderHook(() => useSingleInstanceGuard());
    expect(() => renderHook(() => useSingleInstanceGuard())).toThrow(/Only one instance allowed/);
    first.unmount();
  });

  it('allows a new instance after the previous one unmounts', () => {
    const first = renderHook(() => useSingleInstanceGuard());
    first.unmount();
    expect(() => renderHook(() => useSingleInstanceGuard())).not.toThrow();
  });
});
