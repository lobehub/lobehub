import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import TerminalView from './TerminalView';

const { manager, preference } = vi.hoisted(() => ({
  manager: {
    applyTheme: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    fit: vi.fn(),
    focus: vi.fn(),
  },
  preference: { terminalFontFamily: '"JetBrains Mono"' },
}));

vi.mock('antd-style', () => ({
  useTheme: () => ({ fontFamilyCode: 'Application Mono' }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({ preference: { terminalFontFamily: preference.terminalFontFamily } }),
}));

vi.mock('./theme', () => ({ buildXtermTheme: () => ({ background: '#000' }) }));
vi.mock('./xtermManager', () => ({ xtermManager: manager }));

let resizeCallback: (() => void) | undefined;

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resizeCallback = cb;
      }
      disconnect = vi.fn();
      observe = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  resizeCallback = undefined;
  preference.terminalFontFamily = '"JetBrains Mono"';
});

describe('TerminalView font family', () => {
  it('applies the configured terminal font family', () => {
    render(<TerminalView sessionId={'custom-font'} />);

    expect(manager.applyTheme).toHaveBeenLastCalledWith({ background: '#000' }, '"JetBrains Mono"');
  });

  it('falls back to the application code font for an empty preference', () => {
    preference.terminalFontFamily = '   ';

    render(<TerminalView sessionId={'default-font'} />);

    expect(manager.applyTheme).toHaveBeenLastCalledWith({ background: '#000' }, 'Application Mono');
  });
});

describe('TerminalView refit', () => {
  it('debounces refit across the open/close animation so the PTY resizes once, not per frame', () => {
    render(<TerminalView sessionId={'refit'} />);

    // Mount does one immediate fit so the terminal is sized when it appears.
    expect(manager.fit).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();

    // The height animation fires ResizeObserver on every frame (~16ms apart).
    for (let i = 0; i < 10; i += 1) {
      resizeCallback?.();
      vi.advanceTimersByTime(16);
    }

    // No PTY resize while the frames are still streaming in.
    expect(manager.fit).toHaveBeenCalledTimes(1);

    // Exactly one trailing fit once the animation settles.
    vi.advanceTimersByTime(100);
    expect(manager.fit).toHaveBeenCalledTimes(2);
  });
});
