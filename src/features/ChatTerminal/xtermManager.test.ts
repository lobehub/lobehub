import { beforeEach, describe, expect, it, vi } from 'vitest';

import { xtermManager } from './xtermManager';

const { fitAddonFit, ipcOn, resizeSession } = vi.hoisted(() => ({
  fitAddonFit: vi.fn(),
  ipcOn: vi.fn(),
  resizeSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = fitAddonFit;
  },
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    loadAddon = vi.fn();
    onData = vi.fn();
    open = vi.fn();
    options = {};
    rows = 24;
    write = vi.fn();
  },
}));

vi.mock('@/services/electron/terminal', () => ({
  electronTerminalService: {
    killSession: vi.fn().mockResolvedValue(undefined),
    resizeSession,
    writeSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('debug', () => ({ default: () => vi.fn() }));

describe('xtermManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { on: ipcOn } },
    });
  });

  it('applies appearance changes to every live terminal instance', () => {
    const first = xtermManager.ensure('theme_first');
    const second = xtermManager.ensure('theme_second');
    const host = document.createElement('div');
    document.body.append(host);
    xtermManager.attach('theme_first', host);
    vi.spyOn(first.container, 'getBoundingClientRect').mockReturnValue({
      height: 600,
      width: 800,
    } as DOMRect);
    const theme = { background: '#101010', foreground: '#f0f0f0' };

    xtermManager.applyTheme(theme, 'JetBrains Mono');

    expect(first.term.options).toMatchObject({ fontFamily: 'JetBrains Mono', theme });
    expect(second.term.options).toMatchObject({ fontFamily: 'JetBrains Mono', theme });
    expect(fitAddonFit).toHaveBeenCalledOnce();
    expect(resizeSession).toHaveBeenCalledWith({ cols: 80, id: 'theme_first', rows: 24 });
  });
});
