import type { BrowserKeyCombo } from '@lobechat/device-control/browser-input';
import {
  browserEditCommandOf,
  parseBrowserKey,
  parseBrowserViewport,
} from '@lobechat/device-control/browser-input';
import type {
  BrowserControlClickParams,
  BrowserControlClickResult,
  BrowserControlFillParams,
  BrowserControlParams,
  BrowserControlPressParams,
  BrowserControlReadPageResult,
  BrowserControlResult,
  BrowserControlScreenshotResult,
  BrowserControlScrollParams,
  BrowserControlSetViewportParams,
  BrowserControlSetViewportResult,
  BrowserControlSnapshotResult,
  BrowserControlWaitForParams,
  BrowserGatewayToolResultParams,
  BrowserToolCallResult,
} from '@lobechat/electron-client-ipc';
import type { KeyboardInputEvent, NativeImage, Rectangle, WebContents } from 'electron';
import { clipboard } from 'electron';

import {
  OVERLAY_REMOVE_SCRIPT,
  overlayControllingScript,
  overlayCursorScript,
} from '@/modules/browser/agentOverlayScript';
import { createLogger } from '@/utils/logger';

import BrowserSidebarCtr from './BrowserSidebarCtr';
import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:BrowserControlCtr');

/** How long the renderer cursor animation gets before the real click lands. */
const CURSOR_TRAVEL_MS = 450;
/** Idle window after the last action before the "agent controlling" chip hides. */
const CONTROL_IDLE_MS = 1500;
const MAX_WAIT_MS = 10_000;
const SCREENSHOT_MAX_WIDTH = 1200;
const READ_PAGE_MAX_CHARS = 12_000;
// A gateway-proxied browser call may include a navigation + mount, so give the
// renderer executor generous headroom before giving up.
const GATEWAY_CALL_TIMEOUT_MS = 60_000;

/**
 * A guest that was just shown or just navigated has no compositor frame yet, and
 * Chromium rejects the copy with `UnknownVizError` until one is drawn. Retry a
 * few frames; past that the surface is genuinely unavailable.
 */
const CAPTURE_RETRY_DELAYS_MS = [100, 250, 500];
/** `capturePage` never settles for a guest Chromium is not drawing at all. */
const CAPTURE_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `KeyboardEvent.key` names Electron's `sendInputEvent` spells differently (and silently drops). */
const ELECTRON_KEY_CODES: Record<string, string> = {
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
};

const ELECTRON_MODIFIERS = {
  Alt: 'alt',
  Control: 'control',
  Meta: 'meta',
  Shift: 'shift',
} as const;

/**
 * The `sendInputEvent` sequence for one key press. Only a key that types text
 * gets a `char` event, and never under Control/Alt/Meta: a `char` is what
 * inserts text, so `Control+a` must not type an "a".
 */
export const keyInputEvents = ({ key, modifiers }: BrowserKeyCombo) => {
  const keyCode = ELECTRON_KEY_CODES[key] ?? key;
  const electronModifiers = modifiers.map((modifier) => ELECTRON_MODIFIERS[modifier]);
  const events: KeyboardInputEvent[] = [{ keyCode, modifiers: electronModifiers, type: 'keyDown' }];

  const typesText = [...key].length === 1 || key === 'Enter' || key === 'Space';
  const chorded = modifiers.some((modifier) => modifier !== 'Shift');
  if (typesText && !chorded) {
    events.push({
      keyCode: key === 'Space' ? ' ' : key,
      modifiers: electronModifiers,
      type: 'char',
    });
  }

  events.push({ keyCode, modifiers: electronModifiers, type: 'keyUp' });
  return events;
};

/**
 * A fixed viewport the agent asked for. The page lays out at `width`×`height`
 * and the panel draws it shrunk by `scale` to fit, so input coordinates (panel
 * pixels) are the page's CSS pixels times `scale`.
 */
interface GuestViewport {
  height: number;
  /** Panel size before emulation, kept because emulation hides it from the page. */
  panel: { height: number; width: number };
  scale: number;
  width: number;
}

const emulateViewport = (guest: WebContents, { height, scale, width }: GuestViewport) =>
  guest.enableDeviceEmulation({
    deviceScaleFactor: 0,
    scale,
    screenPosition: 'desktop',
    screenSize: { height, width },
    viewPosition: { x: 0, y: 0 },
    viewSize: { height, width },
  });

const captureOnce = (guest: WebContents, rect?: Rectangle) =>
  new Promise<NativeImage>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`capturePage did not settle within ${CAPTURE_TIMEOUT_MS}ms`)),
      CAPTURE_TIMEOUT_MS,
    );
    (rect ? guest.capturePage(rect) : guest.capturePage()).then(
      (image) => {
        clearTimeout(timer);
        resolve(image);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export const captureGuest = async (guest: WebContents, rect?: Rectangle): Promise<NativeImage> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const image = await captureOnce(guest, rect);
      if (!image.isEmpty()) return image;
      if (attempt >= CAPTURE_RETRY_DELAYS_MS.length) {
        throw new Error('The page has not been drawn yet (empty capture)');
      }
    } catch (error) {
      const retryable = (error as Error).message === 'UnknownVizError';
      if (!retryable || attempt >= CAPTURE_RETRY_DELAYS_MS.length) {
        throw new Error(
          `Screenshot failed: the browser page could not be captured (${(error as Error).message}). ` +
            'snapshot/readPage still work on this page; retrying the screenshot right away will not help.',
          { cause: error },
        );
      }
    }
    await sleep(CAPTURE_RETRY_DELAYS_MS[attempt]);
  }
};

/**
 * `WebContents.executeJavaScript` defers the script until the main frame stops
 * loading, so on a page that never finishes (a pending image, long-poll, dev
 * proxy) every snapshot/readPage/click hung until the caller timed out. The
 * main frame's own `executeJavaScript` runs against the current document now.
 */
const evaluate = (guest: WebContents, code: string): Promise<any> =>
  guest.mainFrame.executeJavaScript(code);

/**
 * Runs inside the guest page. Builds a compact interactive-element snapshot and
 * caches the elements on `window.__lobeBrowserRefs` so later actions can
 * resolve `ref` ids without re-querying.
 */
export const SNAPSHOT_SCRIPT = `(() => {
  const MAX = 250;
  const refs = {};
  let counter = 0;
  const lines = [];
  // Closed modals are commonly kept in the DOM under a wrapper faded to
  // opacity 0, or marked aria-hidden / inert. Their own box still has a size,
  // so checking only the element listed every closed dialog as if it were open.
  // The element's own opacity is not checked: styled checkboxes and file
  // inputs are often a transparent native control over a visible label.
  const hiddenByAncestor = (el) => {
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('inert')) return true;
      if (node !== el && getComputedStyle(node).opacity === '0') return true;
    }
    return false;
  };
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    return !hiddenByAncestor(el);
  };
  const tagRoles = { A: 'link', BUTTON: 'button', H1: 'heading', H2: 'heading', H3: 'heading', SELECT: 'combobox', SUMMARY: 'button', TEXTAREA: 'textbox' };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'hidden') return null;
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'submit' || type === 'button') return 'button';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return tagRoles[el.tagName] || null;
  };
  // Never serialize the value of secret fields (autofilled passwords, card
  // numbers, OTPs) into the snapshot — it goes to the model and is persisted
  // in the tool result.
  const isSensitive = (el) => {
    if (el.tagName !== 'INPUT') return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password') return true;
    if (/(cc-number|cc-csc|cc-exp|current-password|new-password|one-time-code)/i.test(el.getAttribute('autocomplete') || '')) return true;
    return /(password|passwd|pwd|secret|token|otp|cvv|pin)/i.test((el.getAttribute('name') || '') + ' ' + (el.id || ''));
  };
  const nameOf = (el) =>
    (el.getAttribute('aria-label') || el.innerText || (isSensitive(el) ? '' : el.value) || el.placeholder || el.title || el.getAttribute('alt') || '')
      .trim().replaceAll(/\\s+/g, ' ').slice(0, 80);
  const candidates = document.querySelectorAll('a,button,input,select,textarea,summary,h1,h2,h3,[role],[onclick],[contenteditable=true]');
  const seen = new Set();
  for (const el of candidates) {
    if (counter >= MAX) break;
    if (seen.has(el) || !isVisible(el)) continue;
    seen.add(el);
    const role = roleOf(el);
    if (!role || role === 'presentation' || role === 'none') continue;
    const name = nameOf(el);
    if (!name && !['checkbox', 'combobox', 'radio', 'textbox'].includes(role)) continue;
    counter += 1;
    const ref = 'e' + counter;
    refs[ref] = el;
    let line = '- ' + role + ' "' + name + '" [ref=' + ref + ']';
    if (el.disabled) line += ' [disabled]';
    if (role === 'textbox' && el.value) line += isSensitive(el) ? ' [value=<redacted>]' : ' [value="' + String(el.value).slice(0, 40) + '"]';
    if ((role === 'checkbox' || role === 'radio') && el.checked) line += ' [checked]';
    lines.push(line);
  }
  window.__lobeBrowserRefs = refs;
  return JSON.stringify({ snapshot: lines.join('\\n'), title: document.title, url: location.href });
})()`;

const resolveRefScript = (ref: string) => `((ref) => {
  const el = window.__lobeBrowserRefs && window.__lobeBrowserRefs[ref];
  if (!el || !el.isConnected) return JSON.stringify({ error: 'ref not found — take a new snapshot first' });
  el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
})(${JSON.stringify(ref)})`;

export const fillScript = (ref: string, text: string) => `((ref, text) => {
  const el = window.__lobeBrowserRefs && window.__lobeBrowserRefs[ref];
  if (!el || !el.isConnected) return JSON.stringify({ error: 'ref not found — take a new snapshot first' });
  el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  el.focus();
  // A native <select> has no text to type into, and calling the input value
  // setter on it throws. Pick the option by value, then by visible label.
  if (el.tagName === 'SELECT') {
    const options = Array.from(el.options);
    // The rendered label is the non-empty label attribute, else the text.
    const shown = (option) => (option.getAttribute('label') || option.text).trim();
    const label = (option) => shown(option).replaceAll(/\\s+/g, ' ').toLowerCase();
    const wanted = String(text).trim().replaceAll(/\\s+/g, ' ').toLowerCase();
    const option = options.find((o) => o.value === text) || options.find((o) => label(o) === wanted);
    if (!option) {
      const names = options.map(shown).slice(0, 30).join(', ');
      return JSON.stringify({ error: 'no option matches "' + text + '"; options: ' + names });
    }
    // Assign by index: option values need not be unique (an empty placeholder
    // and an empty "None"), and el.value would pick the first match.
    el.selectedIndex = options.indexOf(option);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ ok: true });
  }
  if (el.isContentEditable) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return JSON.stringify({ ok: true });
  }
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
  if (!setter) return JSON.stringify({ error: 'element is not fillable' });
  setter.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return JSON.stringify({ ok: true });
})(${JSON.stringify(ref)}, ${JSON.stringify(text)})`;

const READ_PAGE_SCRIPT = `JSON.stringify({
  content: (document.body ? document.body.innerText : '').replaceAll(/\\n{3,}/g, '\\n\\n').slice(0, ${READ_PAGE_MAX_CHARS}),
  selectedText: (window.getSelection ? window.getSelection().toString() : '').replaceAll(/\\n{3,}/g, '\\n\\n').trim().slice(0, ${READ_PAGE_MAX_CHARS}),
  title: document.title,
  url: location.href,
})`;

const containsTextScript = (text: string) =>
  `document.body ? document.body.innerText.includes(${JSON.stringify(text)}) : false`;

export default class BrowserControlCtr extends ControllerModule {
  static override readonly groupName = 'browserControl';

  private idleTimers = new Map<string, NodeJS.Timeout>();
  /** Kept per page, not per session: a remounted guest starts at the panel size again. */
  private viewports = new WeakMap<WebContents, GuestViewport>();
  private pendingGatewayCalls = new Map<
    string,
    { reject: (reason: Error) => void; resolve: (result: BrowserToolCallResult) => void }
  >();
  private gatewayCallSeq = 0;

  /**
   * Entry for cloud-agent (gateway) browser tool calls routed back to this
   * device. Forwards the call to the renderer, which runs the same client
   * `browserExecutor` used for local runs — so the mount / snapshot / click
   * logic has one source of truth. Resolves with the executor's result.
   */
  async runGatewayToolCall(
    apiName: string,
    args: Record<string, unknown>,
  ): Promise<BrowserToolCallResult> {
    const {
      __agentId: agentId,
      __topicId: topicId,
      ...toolArgs
    } = args as { __agentId?: string; __topicId?: string };
    if (!agentId) {
      return { content: 'Browser tool call is missing the agent context', success: false };
    }
    if (!topicId) {
      return { content: 'Browser tool call is missing the topic context', success: false };
    }

    const win = this.app.browserManager.getMainWindow();
    if (!win) {
      return { content: 'The desktop app window is not available', success: false };
    }

    this.gatewayCallSeq += 1;
    const requestId = `bgw_${this.gatewayCallSeq}`;

    return new Promise<BrowserToolCallResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingGatewayCalls.delete(requestId);
        reject(new Error('Browser tool call timed out'));
      }, GATEWAY_CALL_TIMEOUT_MS);

      this.pendingGatewayCalls.set(requestId, {
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      });

      win.broadcast('browserSidebarGatewayToolCall', {
        agentId,
        apiName,
        args: toolArgs,
        requestId,
        topicId,
      });
    }).catch((error: Error) => ({ content: error.message, success: false }));
  }

  /** Renderer reports the executor result for a proxied gateway tool call. */
  @IpcMethod()
  reportGatewayToolResult(params: BrowserGatewayToolResultParams): void {
    const pending = this.pendingGatewayCalls.get(params.requestId);
    if (!pending) return;
    this.pendingGatewayCalls.delete(params.requestId);
    pending.resolve(params.result);
  }

  @IpcMethod()
  async snapshot(params: BrowserControlParams): Promise<BrowserControlSnapshotResult> {
    return this.withGuest(params.sessionId, async (guest) => {
      const raw = await evaluate(guest, SNAPSHOT_SCRIPT);
      const parsed = JSON.parse(raw);
      return { success: true, ...parsed };
    });
  }

  @IpcMethod()
  async click(params: BrowserControlClickParams): Promise<BrowserControlClickResult> {
    return this.withGuest(params.sessionId, async (guest) => {
      let { x, y } = params;

      if (params.ref) {
        const raw = await evaluate(guest, resolveRefScript(params.ref));
        const resolved = JSON.parse(raw);
        if (resolved.error) return { error: resolved.error, success: false };
        x = resolved.x;
        y = resolved.y;
        // scrollIntoView may animate layout; let the rect settle.
        await sleep(80);
      }

      if (typeof x !== 'number' || typeof y !== 'number') {
        return { error: 'click needs a ref or x/y coordinates', success: false };
      }

      this.markControlling(params.sessionId, guest);
      this.showCursor(guest, x, y, true);
      await sleep(CURSOR_TRAVEL_MS);

      // The cursor overlay lives in the page (CSS pixels); input lands on the panel.
      const scale = this.viewports.get(guest)?.scale ?? 1;
      const at = { x: Math.round(x * scale), y: Math.round(y * scale) };
      guest.sendInputEvent({ type: 'mouseMove', ...at });
      guest.sendInputEvent({ button: 'left', clickCount: 1, type: 'mouseDown', ...at });
      guest.sendInputEvent({ button: 'left', clickCount: 1, type: 'mouseUp', ...at });

      await sleep(300);
      return { success: true, title: guest.getTitle(), url: guest.getURL() };
    });
  }

  @IpcMethod()
  async fill(params: BrowserControlFillParams): Promise<BrowserControlResult> {
    return this.withGuest(params.sessionId, async (guest) => {
      this.markControlling(params.sessionId, guest);
      const raw = await evaluate(guest, fillScript(params.ref, params.text));
      const result = JSON.parse(raw);
      if (result.error) return { error: result.error, success: false };

      if (params.submit) {
        await sleep(80);
        await this.sendKey(guest, parseBrowserKey('Enter'));
      }

      return { success: true };
    });
  }

  @IpcMethod()
  async press(params: BrowserControlPressParams): Promise<BrowserControlResult> {
    let combo: BrowserKeyCombo;
    try {
      combo = parseBrowserKey(params.key);
    } catch (error) {
      return { error: (error as Error).message, success: false };
    }

    return this.withGuest(params.sessionId, async (guest) => {
      this.markControlling(params.sessionId, guest);
      await this.sendKey(guest, combo);
      return { success: true };
    });
  }

  /**
   * Lays the page out at a fixed size, e.g. a desktop width while the panel is
   * narrow, and shrinks it to fit the panel. Without a size the page goes back
   * to the panel's own size.
   */
  @IpcMethod()
  async setViewport(
    params: BrowserControlSetViewportParams,
  ): Promise<BrowserControlSetViewportResult> {
    let size: { height: number; width: number } | undefined;
    try {
      size = parseBrowserViewport(params);
    } catch (error) {
      return { error: (error as Error).message, success: false };
    }

    return this.withGuest(params.sessionId, async (guest) => {
      const current = this.viewports.get(guest);
      if (!size) {
        if (current) {
          this.viewports.delete(guest);
          guest.disableDeviceEmulation();
        }
        return { scale: 1, success: true };
      }

      const panel =
        current?.panel ??
        (JSON.parse(
          await evaluate(guest, 'JSON.stringify({ height: innerHeight, width: innerWidth })'),
        ) as GuestViewport['panel']);
      const scale = Math.min(1, panel.width / size.width, panel.height / size.height);
      const viewport = { ...size, panel, scale };

      // Chromium drops the emulation with each new document, so re-apply it.
      if (!current) {
        guest.on('did-navigate', () => {
          const latest = this.viewports.get(guest);
          if (latest) emulateViewport(guest, latest);
        });
      }
      this.viewports.set(guest, viewport);
      emulateViewport(guest, viewport);
      return { scale, success: true };
    });
  }

  @IpcMethod()
  async scroll(params: BrowserControlScrollParams): Promise<BrowserControlResult> {
    return this.withGuest(params.sessionId, async (guest) => {
      this.markControlling(params.sessionId, guest);
      await evaluate(
        guest,
        `window.scrollBy({ behavior: 'smooth', left: ${Number(params.dx) || 0}, top: ${Number(params.dy) || 0} })`,
      );
      await sleep(350);
      return { success: true };
    });
  }

  @IpcMethod()
  async screenshot(params: BrowserControlParams): Promise<BrowserControlScreenshotResult> {
    return this.withGuest(params.sessionId, async (guest) => {
      // Strip the agent cursor/chip first — otherwise the model sees its own
      // overlay in the frame it just asked for.
      await evaluate(guest, OVERLAY_REMOVE_SCRIPT).catch(() => {});

      // A fitted viewport leaves the rest of the panel blank; capture the page only.
      const viewport = this.viewports.get(guest);
      let image = await captureGuest(
        guest,
        viewport && {
          height: Math.floor(viewport.height * viewport.scale),
          width: Math.floor(viewport.width * viewport.scale),
          x: 0,
          y: 0,
        },
      );
      const size = image.getSize();
      if (size.width > SCREENSHOT_MAX_WIDTH) image = image.resize({ width: SCREENSHOT_MAX_WIDTH });
      const resized = image.getSize();
      const dataUrl = `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`;
      return { dataUrl, height: resized.height, success: true, width: resized.width };
    });
  }

  @IpcMethod()
  async readPage(params: BrowserControlParams): Promise<BrowserControlReadPageResult> {
    return this.withGuest(params.sessionId, async (guest) => {
      const raw = await evaluate(guest, READ_PAGE_SCRIPT);
      return { success: true, ...JSON.parse(raw) };
    });
  }

  @IpcMethod()
  async waitFor(params: BrowserControlWaitForParams): Promise<BrowserControlResult> {
    return this.withGuest(params.sessionId, async (guest) => {
      const deadline = Date.now() + Math.min(params.ms ?? 3000, MAX_WAIT_MS);

      if (!params.text) {
        await sleep(Math.max(deadline - Date.now(), 0));
        return { success: true };
      }

      while (Date.now() < deadline) {
        if (guest.isDestroyed()) return { error: 'Browser page was closed', success: false };
        const found = await evaluate(guest, containsTextScript(params.text));
        if (found) return { success: true };
        await sleep(250);
      }

      return { error: `Timed out waiting for text: ${params.text}`, success: false };
    });
  }

  private get sidebar() {
    return this.app.getController(BrowserSidebarCtr);
  }

  private async withGuest<T extends BrowserControlResult>(
    sessionId: string,
    action: (guest: WebContents) => T | Promise<T>,
  ): Promise<T> {
    const guest = this.sidebar.getSessionWebContents(sessionId);
    if (!guest) {
      return {
        error: 'Browser is not open for this conversation — navigate to a URL first',
        success: false,
      } as T;
    }

    try {
      return await action(guest);
    } catch (error) {
      logger.error(`Browser control action failed for ${sessionId}:`, error);
      return { error: (error as Error).message, success: false } as T;
    }
  }

  private async sendKey(guest: WebContents, combo: BrowserKeyCombo) {
    guest.focus();
    for (const event of keyInputEvents(combo)) guest.sendInputEvent(event);
    // On macOS, Chromium leaves Meta+A/C/V/X/Z to the app menu, which a
    // synthesized key event never reaches.
    const editCommand = browserEditCommandOf(combo);
    if (!editCommand) return;
    // `guest.selectAll()`/`paste()` act on the guest's focused frame, which the
    // in-app <webview> often does not have, so they silently did nothing. The
    // page runs the command itself; the user gesture lets copy/cut through.
    // Pages may not read the clipboard, so paste inserts the text read here
    // (`readText` resolves asynchronously since Electron 44).
    const script =
      editCommand === 'paste'
        ? `document.execCommand('insertText', false, ${JSON.stringify(await clipboard.readText())})`
        : `document.execCommand(${JSON.stringify(editCommand)})`;
    await guest.mainFrame.executeJavaScript(script, true);
  }

  /**
   * The overlay is injected into the guest so it follows page scrolling and zoom.
   */
  private inject(guest: WebContents, script: string) {
    evaluate(guest, script).catch((error: Error) => {
      logger.debug(`Agent overlay injection failed: ${error.message}`);
    });
  }

  private showCursor(guest: WebContents, x: number, y: number, click: boolean) {
    this.inject(guest, overlayCursorScript(this.sidebar.getOverlayLabels(), x, y, click));
  }

  private markControlling(sessionId: string, guest: WebContents) {
    const existing = this.idleTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    else this.inject(guest, overlayControllingScript(this.sidebar.getOverlayLabels(), true));

    this.idleTimers.set(
      sessionId,
      setTimeout(() => {
        this.idleTimers.delete(sessionId);
        if (guest.isDestroyed()) return;
        this.inject(guest, overlayControllingScript(this.sidebar.getOverlayLabels(), false));
      }, CONTROL_IDLE_MS),
    );
  }
}
