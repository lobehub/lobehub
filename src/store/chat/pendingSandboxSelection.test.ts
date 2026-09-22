import { describe, expect, it, vi } from 'vitest';

import {
  consumePendingSandboxSelection,
  getPendingSandboxSelection,
  setPendingSandboxSelection,
  subscribePendingSandboxSelection,
} from './pendingSandboxSelection';

describe('pendingSandboxSelection', () => {
  it('notifies a subscriber on set and on consume — a second reader must move too', () => {
    // Two components read this: the switch that writes and the chip that only
    // reads. A Map cannot tell React it changed, so a write that told only its
    // own component left the chip on the old value.
    const listener = vi.fn();
    const unsubscribe = subscribePendingSandboxSelection(listener);

    setPendingSandboxSelection('agent-1', { mode: 'persistent' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPendingSandboxSelection('agent-1')).toEqual({ mode: 'persistent' });

    consumePendingSandboxSelection('agent-1');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getPendingSandboxSelection('agent-1')).toBeUndefined();

    unsubscribe();
    setPendingSandboxSelection('agent-1', { mode: 'ephemeral' });
    expect(listener).toHaveBeenCalledTimes(2);
    consumePendingSandboxSelection('agent-1');
  });

  it('returns a stable value between writes, as useSyncExternalStore requires', () => {
    setPendingSandboxSelection('agent-2', { instanceId: 'i', mode: 'persistent' });
    expect(getPendingSandboxSelection('agent-2')).toBe(getPendingSandboxSelection('agent-2'));
    consumePendingSandboxSelection('agent-2');
  });
});
