import { beforeEach, describe, expect, it, vi } from 'vitest';

import { xtermManager } from './xtermManager';

const { fitAddonFit, ipcOn, resizeSession, webglInstances, webglShouldThrow } = vi.hoisted(() => ({
  fitAddonFit: vi.fn(),
  ipcOn: vi.fn(),
  resizeSession: vi.fn().mockResolvedValue(undefined),
  webglInstances: [] as { contextLoss: () => void; dispose: ReturnType<typeof vi.fn> }[],
  webglShouldThrow: { value: false },
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = fitAddonFit;
  },
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    contextLoss = () => {};
    dispose = vi.fn();
    onContextLoss = (cb: () => void) => {
      this.contextLoss = cb;
    };

    constructor() {
      if (webglShouldThrow.value) throw new Error('WebGL2 unavailable');
      webglInstances.push(this);
    }
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
    webglInstances.length = 0;
    webglShouldThrow.value = false;
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

  it('loads the WebGL addon on attach and disposes it on detach', () => {
    const host = document.createElement('div');
    document.body.append(host);

    xtermManager.attach('webgl_lifecycle', host);
    expect(webglInstances).toHaveLength(1);
    const instance = xtermManager.ensure('webgl_lifecycle');
    expect(instance.term.loadAddon).toHaveBeenCalledWith(webglInstances[0]);
    expect(instance.webgl).toBe(webglInstances[0]);

    xtermManager.detach('webgl_lifecycle');
    expect(webglInstances[0].dispose).toHaveBeenCalledOnce();
    expect(instance.webgl).toBeUndefined();

    xtermManager.attach('webgl_lifecycle', host);
    expect(webglInstances).toHaveLength(2);
    expect(instance.webgl).toBe(webglInstances[1]);
  });

  it('drops to the DOM renderer on context loss and retries on next attach', () => {
    const host = document.createElement('div');
    document.body.append(host);
    xtermManager.attach('webgl_loss', host);
    const instance = xtermManager.ensure('webgl_loss');

    webglInstances[0].contextLoss();

    expect(webglInstances[0].dispose).toHaveBeenCalledOnce();
    expect(instance.webgl).toBeUndefined();

    xtermManager.detach('webgl_loss');
    xtermManager.attach('webgl_loss', host);
    expect(webglInstances).toHaveLength(2);
    expect(instance.webgl).toBe(webglInstances[1]);
  });

  it('survives a throwing WebGL addon dispose on detach', () => {
    const host = document.createElement('div');
    document.body.append(host);
    xtermManager.attach('webgl_dispose_throw', host);
    const instance = xtermManager.ensure('webgl_dispose_throw');
    webglInstances[0].dispose.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading '_isDisposed')");
    });

    expect(() => xtermManager.detach('webgl_dispose_throw')).not.toThrow();
    expect(instance.webgl).toBeUndefined();
    expect(host.contains(instance.container)).toBe(false);

    xtermManager.attach('webgl_dispose_throw', host);
    expect(instance.webgl).toBe(webglInstances[1]);
  });

  it('falls back permanently when the WebGL addon fails to initialize', () => {
    const host = document.createElement('div');
    document.body.append(host);
    webglShouldThrow.value = true;

    expect(() => xtermManager.attach('webgl_broken', host)).not.toThrow();
    expect(xtermManager.ensure('webgl_broken').webgl).toBeUndefined();

    webglShouldThrow.value = false;
    xtermManager.attach('webgl_after_broken', host);
    expect(webglInstances).toHaveLength(0);
  });
});
