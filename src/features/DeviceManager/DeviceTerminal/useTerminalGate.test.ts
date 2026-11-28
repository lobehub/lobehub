import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DeviceTerminalAvailability } from './availability';
import { useTerminalGate } from './useTerminalGate';

describe('useTerminalGate', () => {
  it('stays closed until the device can host a shell', () => {
    const { result, rerender } = renderHook((a: DeviceTerminalAvailability) => useTerminalGate(a), {
      initialProps: 'offline',
    });
    expect(result.current).toBe(false);

    rerender('unsupported');
    expect(result.current).toBe(false);
  });

  it('keeps a live shell when the device list briefly reports the device offline', () => {
    const { result, rerender } = renderHook((a: DeviceTerminalAvailability) => useTerminalGate(a), {
      initialProps: 'ready',
    });
    expect(result.current).toBe(true);

    rerender('offline');
    expect(result.current).toBe(true);
    rerender('checking');
    expect(result.current).toBe(true);
  });
});
