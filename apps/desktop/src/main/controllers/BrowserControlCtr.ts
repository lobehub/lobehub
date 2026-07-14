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
  BrowserControlSnapshotResult,
  BrowserControlWaitForParams,
  BrowserGatewayToolResultParams,
  BrowserToolCallResult,
} from '@lobechat/electron-client-ipc';
import type { WebContents } from 'electron';

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs inside the guest page. Builds a compact interactive-element snapshot and
 * caches the elements on `window.__lobeBrowserRefs` so later actions can
 * resolve `ref` ids without re-querying.
 */
const SNAPSHOT_SCRIPT = `(() => {
  const MAX = 250;
  const refs = {};
  let counter = 0;
  const lines = [];
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
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

const fillScript = (ref: string, text: string) => `((ref, text) => {
  const el = window.__lobeBrowserRefs && window.__lobeBrowserRefs[ref];
  if (!el || !el.isConnected) return JSON.stringify({ error: 'ref not found — take a new snapshot first' });
  el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  el.focus();
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
    const { __agentId: agentId, ...toolArgs } = args as { __agentId?: string };
    if (!agentId) {
      return { content: 'Browser tool call is missing the agent context', success: false };
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
      const raw = await guest.executeJavaScript(SNAPSHOT_SCRIPT);
      const parsed = JSON.parse(raw);
      return { success: true, ...parsed };
    });
  }

  @IpcMethod()
  async click(params: BrowserControlClickParams): Promise<BrowserControlClickResult> {
    return this.withGuest(params.sessionId, async (guest) => {
      let { x, y } = params;

      if (params.ref) {
        const raw = await guest.executeJavaScript(resolveRefScript(params.ref));
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

      this.markControlling(params.sessionId);
      this.broadcastCursor(params.sessionId, x, y, true);
      await sleep(CURSOR_TRAVEL_MS);

      guest.sendInputEvent({ type: 'mouseMove', x, y });
      guest.sendInputEvent({ button: 'left', clickCount: 1, type: 'mouseDown', x, y });
      guest.sendInputEvent({ button: 'left', clickCount: 1, type: 'mouseUp', x, y });

      await sleep(300);
      return { success: true, title: guest.getTitle(), url: guest.getURL() };
    });
  }

  @IpcMethod()
  async fill(params: BrowserControlFillParams): Promise<BrowserControlResult> {
    return this.withGuest(params.sessionId, async (guest) => {
      this.markControlling(params.sessionId);
      const raw = await guest.executeJavaScript(fillScript(params.ref, params.text));
      const result = JSON.parse(raw);
      if (result.error) return { error: result.error, success: false };

      if (params.submit) {
        await sleep(80);
        this.sendKey(guest, 'Enter');
      }

      return { success: true };
    });
  }

  @IpcMethod()
  async press(params: BrowserControlPressParams): Promise<BrowserControlResult> {
    return this.withGuest(params.sessionId, (guest) => {
      this.markControlling(params.sessionId);
      this.sendKey(guest, params.key);
      return { success: true };
    });
  }

  @IpcMethod()
  async scroll(params: BrowserControlScrollParams): Promise<BrowserControlResult> {
    return this.withGuest(params.sessionId, async (guest) => {
      this.markControlling(params.sessionId);
      await guest.executeJavaScript(
        `window.scrollBy({ behavior: 'smooth', left: ${Number(params.dx) || 0}, top: ${Number(params.dy) || 0} })`,
      );
      await sleep(350);
      return { success: true };
    });
  }

  @IpcMethod()
  async screenshot(params: BrowserControlParams): Promise<BrowserControlScreenshotResult> {
    return this.withGuest(params.sessionId, async (guest) => {
      let image = await guest.capturePage();
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
      const raw = await guest.executeJavaScript(READ_PAGE_SCRIPT);
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
        const found = await guest.executeJavaScript(containsTextScript(params.text));
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

  private sendKey(guest: WebContents, key: string) {
    guest.focus();
    guest.sendInputEvent({ keyCode: key, type: 'keyDown' });
    if (key.length === 1 || key === 'Enter') guest.sendInputEvent({ keyCode: key, type: 'char' });
    guest.sendInputEvent({ keyCode: key, type: 'keyUp' });
  }

  private broadcastCursor(sessionId: string, x: number, y: number, click?: boolean) {
    this.app.browserManager.broadcastToAllWindows('browserSidebarAgentCursor', {
      click,
      sessionId,
      x,
      y,
    });
  }

  private markControlling(sessionId: string) {
    const existing = this.idleTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    else
      this.app.browserManager.broadcastToAllWindows('browserSidebarAgentState', {
        active: true,
        sessionId,
      });

    this.idleTimers.set(
      sessionId,
      setTimeout(() => {
        this.idleTimers.delete(sessionId);
        this.app.browserManager.broadcastToAllWindows('browserSidebarAgentState', {
          active: false,
          sessionId,
        });
      }, CONTROL_IDLE_MS),
    );
  }
}
