import { expect, it, vi } from 'vitest';

import { registerPendingHotkeyCard } from './pendingHotkeys';

it('lets an inline card handle focused shortcuts without taking page-level shortcuts', () => {
  const window = new EventTarget();
  vi.stubGlobal('window', window);
  const pending = vi.fn();
  const inline = vi.fn();
  const inlineTarget = {} as Node;
  const unregisterPending = registerPendingHotkeyCard({
    contains: () => false,
    onKeyDown: pending,
  });
  const unregisterInline = registerPendingHotkeyCard({
    contains: (node) => node === inlineTarget,
    focusOnly: true,
    onKeyDown: inline,
  });

  try {
    window.dispatchEvent(new Event('keydown'));
    expect(pending).toHaveBeenCalledOnce();
    expect(inline).not.toHaveBeenCalled();

    const focused = new Event('keydown');
    Object.defineProperty(focused, 'target', { value: inlineTarget });
    window.dispatchEvent(focused);
    expect(inline).toHaveBeenCalledWith(focused);
    expect(pending).toHaveBeenCalledOnce();
  } finally {
    unregisterInline();
    unregisterPending();
    vi.unstubAllGlobals();
  }
});
