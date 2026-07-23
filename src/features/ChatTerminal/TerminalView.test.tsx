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

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn();
      observe = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
