import '@xterm/xterm/css/xterm.css';

import type { TerminalDataPayload, TerminalExitPayload } from '@lobechat/electron-client-ipc';
import { FitAddon } from '@xterm/addon-fit';
import type { ITheme } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import debug from 'debug';

import { electronTerminalService } from '@/services/electron/terminal';

const log = debug('lobe-desktop:chat-terminal');

interface TermInstance {
  container: HTMLDivElement;
  fit: FitAddon;
  opened: boolean;
  term: Terminal;
}

type ExitListener = (sessionId: string, exitCode: number) => void;

/**
 * Module-level registry of live xterm instances, keyed by PTY session id.
 *
 * The PTY lives in the main process; this registry keeps the renderer-side
 * xterm (and its scrollback) alive across panel collapse, tab switches and
 * topic switches — the React view only attaches/detaches the container DOM.
 */
class XtermManager {
  private instances = new Map<string, TermInstance>();
  private exitListeners = new Set<ExitListener>();
  private ipcBound = false;

  private bindIpc() {
    if (this.ipcBound) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    this.ipcBound = true;

    ipc.on('terminalData' as any, (_e: any, payload: TerminalDataPayload) => {
      this.instances.get(payload.id)?.term.write(payload.data);
    });
    ipc.on('terminalExit' as any, (_e: any, payload: TerminalExitPayload) => {
      // The PTY is already gone in the main process — just tear down the view.
      this.disposeInstance(payload.id);
      for (const listener of this.exitListeners) listener(payload.id, payload.exitCode);
    });
  }

  onSessionExit(listener: ExitListener) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  ensure(sessionId: string): TermInstance {
    this.bindIpc();
    const existing = this.instances.get(sessionId);
    if (existing) return existing;

    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: 12,
      macOptionIsMeta: true,
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.onData((data) => {
      void electronTerminalService.writeSession({ data, id: sessionId });
    });

    const instance: TermInstance = { container, fit, opened: false, term };
    this.instances.set(sessionId, instance);
    return instance;
  }

  /** Attach the instance's container under `host` and open the terminal on first attach. */
  attach(sessionId: string, host: HTMLElement) {
    const instance = this.ensure(sessionId);
    host.append(instance.container);
    if (!instance.opened) {
      instance.term.open(instance.container);
      instance.opened = true;
    }
  }

  detach(sessionId: string) {
    this.instances.get(sessionId)?.container.remove();
  }

  focus(sessionId: string) {
    this.instances.get(sessionId)?.term.focus();
  }

  /** Refit to the container size and propagate the new grid to the PTY. */
  fit(sessionId: string) {
    const instance = this.instances.get(sessionId);
    if (!instance?.opened || !instance.container.isConnected) return;
    const { width, height } = instance.container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    instance.fit.fit();
    void electronTerminalService.resizeSession({
      cols: instance.term.cols,
      id: sessionId,
      rows: instance.term.rows,
    });
  }

  applyTheme(theme: ITheme, fontFamily: string) {
    for (const { term } of this.instances.values()) {
      term.options.theme = theme;
      term.options.fontFamily = fontFamily;
    }
  }

  /** Kill the PTY in the main process and drop the local instance. */
  close(sessionId: string) {
    // Best-effort: the session may already be gone (shell exited / reaped).
    // The main process logs kill failures on its side too.
    void electronTerminalService.killSession({ id: sessionId }).catch((error) => {
      log('killSession %s failed: %O', sessionId, error);
    });
    this.disposeInstance(sessionId);
  }

  private disposeInstance(sessionId: string) {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    this.instances.delete(sessionId);
    instance.container.remove();
    instance.term.dispose();
  }
}

export const xtermManager = new XtermManager();
