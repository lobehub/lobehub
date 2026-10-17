import '@xterm/xterm/css/xterm.css';

import type { TerminalDataPayload, TerminalExitPayload } from '@lobechat/electron-client-ipc';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import type { ITheme } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import debug from 'debug';

import { electronTerminalService } from '@/services/electron/terminal';

import { resolveTerminalKeyAction } from './keybindings';
import { openTerminalLink } from './links';

const log = debug('lobe-desktop:chat-terminal');

interface TermInstance {
  container: HTMLDivElement;
  fit: FitAddon;
  opened: boolean;
  term: Terminal;
  webgl?: WebglAddon;
}

type ExitListener = (sessionId: string, exitCode: number) => void;
type PaneNavListener = (sessionId: string, direction: -1 | 1) => void;

/**
 * How one session's terminal talks to its shell.
 *
 * The default sink is this machine's Electron main process. A session opened on
 * a remote device registers its own sink instead — the panel, the xterm
 * instance and the tab bookkeeping are identical either way, only the wire
 * differs.
 */
export interface TerminalSessionSink {
  close: (sessionId: string) => void;
  resize: (sessionId: string, cols: number, rows: number) => void;
  write: (sessionId: string, data: string) => void;
}

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
  private paneNavListeners = new Set<PaneNavListener>();
  private ipcBound = false;
  private webglUnavailable = false;
  /** Per-session overrides; absent means the local Electron sink below. */
  private sinks = new Map<string, TerminalSessionSink>();

  /**
   * The sink every session uses unless it registers its own: this machine's
   * Electron main process, which owns the PTY.
   */
  private localSink: TerminalSessionSink = {
    close: (sessionId) => {
      // Best-effort: the session may already be gone (shell exited / reaped).
      // The main process logs kill failures on its side too.
      void electronTerminalService.killSession({ id: sessionId }).catch((error) => {
        log('killSession %s failed: %O', sessionId, error);
      });
    },
    resize: (sessionId, cols, rows) => {
      void electronTerminalService.resizeSession({ cols, id: sessionId, rows });
    },
    write: (sessionId, data) => {
      void electronTerminalService.writeSession({ data, id: sessionId });
    },
  };

  /** Route one session's input and resize to a shell that is not on this machine. */
  setSessionSink(sessionId: string, sink: TerminalSessionSink) {
    this.sinks.set(sessionId, sink);
  }

  private sinkFor(sessionId: string): TerminalSessionSink {
    return this.sinks.get(sessionId) ?? this.localSink;
  }

  /** Write output into a session's terminal. Called by a remote transport. */
  write(sessionId: string, data: string) {
    this.instances.get(sessionId)?.term.write(data);
  }

  /** A remote session ended: drop the view and let the store close its pane. */
  notifyExit(sessionId: string, exitCode: number) {
    this.disposeInstance(sessionId);
    for (const listener of this.exitListeners) listener(sessionId, exitCode);
  }

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

  /** ⌘⌥←/→ — the store owns which pane sits next to which, so it resolves the move. */
  onPaneNavigate(listener: PaneNavListener) {
    this.paneNavListeners.add(listener);
    return () => this.paneNavListeners.delete(listener);
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
      // Handles OSC 8 hyperlinks; WebLinksAddon below covers bare URLs in output.
      linkHandler: { activate: (_event, uri) => openTerminalLink(uri) },
      macOptionIsMeta: true,
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_event, uri) => openTerminalLink(uri)));
    term.attachCustomKeyEventHandler((event) => {
      const action = resolveTerminalKeyAction(event);
      if (!action) return true;
      // Chromium maps ⌘← to history-back, so an unclaimed key would navigate
      // the SPA out from under the panel.
      event.preventDefault();
      switch (action.type) {
        case 'focusSiblingPane': {
          for (const listener of this.paneNavListeners) listener(sessionId, action.direction);
          break;
        }
        case 'scrollPages': {
          term.scrollPages(action.pages);
          break;
        }
        case 'scrollToBottom': {
          term.scrollToBottom();
          break;
        }
        case 'scrollToTop': {
          term.scrollToTop();
          break;
        }
        case 'send': {
          term.input(action.bytes);
          break;
        }
      }
      return false;
    });
    term.onData((data) => {
      this.sinkFor(sessionId).write(sessionId, data);
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
    this.enableWebgl(instance);
  }

  detach(sessionId: string) {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    // Browsers cap live WebGL contexts (~8-16) and silently evict the oldest,
    // so only the visible terminal keeps one — hidden tabs fall back to the
    // (inert) DOM renderer until re-attached.
    this.disposeWebgl(instance);
    instance.container.remove();
  }

  private enableWebgl(instance: TermInstance) {
    if (this.webglUnavailable || instance.webgl) return;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        // Context reclaimed (OOM / resume from sleep) — drop to the DOM
        // renderer now; the next attach retries WebGL.
        if (instance.webgl === webgl) this.disposeWebgl(instance);
      });
      instance.term.loadAddon(webgl);
      instance.webgl = webgl;
    } catch (error) {
      this.webglUnavailable = true;
      log('WebGL renderer unavailable, falling back to DOM: %O', error);
    }
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
    this.sinkFor(sessionId).resize(sessionId, instance.term.cols, instance.term.rows);
  }

  applyTheme(theme: ITheme, fontFamily: string) {
    for (const [sessionId, { term }] of this.instances) {
      term.options.theme = theme;
      term.options.fontFamily = fontFamily;
      this.fit(sessionId);
    }
  }

  /** End the shell (wherever it runs) and drop the local instance. */
  close(sessionId: string) {
    this.sinkFor(sessionId).close(sessionId);
    this.disposeInstance(sessionId);
  }

  // Addon dispose reaches into xterm core internals and can throw when the
  // addon and core versions drift (e.g. addon-webgl 0.19 on xterm 5.5) —
  // cleanup paths must survive it or unmount breaks.
  private disposeWebgl(instance: TermInstance) {
    const { webgl } = instance;
    if (!webgl) return;
    instance.webgl = undefined;
    try {
      webgl.dispose();
    } catch (error) {
      log('webgl addon dispose failed: %O', error);
    }
  }

  private disposeInstance(sessionId: string) {
    // Drop the routing either way: a session whose transport died must not keep
    // a stale sink alive for an id that could be reused.
    this.sinks.delete(sessionId);
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    this.instances.delete(sessionId);
    this.disposeWebgl(instance);
    instance.container.remove();
    instance.term.dispose();
  }
}

export const xtermManager = new XtermManager();
