import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTerminalEntry } from './useTerminalEntry';

const env = vi.hoisted(() => ({ hasDevice: false, isDesktop: false, isHetero: false }));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isDesktop() {
    return env.isDesktop;
  },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { isCurrentAgentHeterogeneous: () => env.isHetero },
}));
vi.mock('@/store/device', () => ({
  deviceSelectors: { hasTerminalTarget: () => env.hasDevice },
  useDeviceStore: (selector: (s: unknown) => unknown) => selector({}),
}));

const entry = (placement: 'header' | 'overview') =>
  renderHook(() => useTerminalEntry(placement)).result.current;

describe('useTerminalEntry', () => {
  beforeEach(() => {
    Object.assign(env, { hasDevice: false, isDesktop: true, isHetero: false });
  });

  it('keeps an ordinary agent’s terminal in the Overview, not the header', () => {
    expect(entry('header')).toBe(false);
    expect(entry('overview')).toBe(true);
  });

  it('keeps a coding agent’s terminal in the header, not the Overview', () => {
    env.isHetero = true;

    expect(entry('header')).toBe(true);
    expect(entry('overview')).toBe(false);
  });

  it('shows neither on the web until a device can host a shell', () => {
    env.isDesktop = false;
    expect(entry('header')).toBe(false);
    expect(entry('overview')).toBe(false);

    env.hasDevice = true;
    expect(entry('overview')).toBe(true);
  });
});
