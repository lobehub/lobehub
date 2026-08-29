import { ensureElectronIpc } from '@/utils/electron/ipc';

const BROWSER_PARTITION = 'persist:lobe-browser-app';
const HIDDEN_HOST_ID = 'lobe-browser-retained-webviews';
const PORTAL_ROOT_ID = 'lobe-ui-theme-app';
export const MAX_RETAINED_BROWSER_WEBVIEWS = 10;
const RETAINED_IN_USE_GRACE_MS = 60_000;
const BOUNDS_POLL_INTERVAL_MS = 100;
const RESIZE_BRIDGE_WIDTH = 10;
const RESIZE_HANDLE_SELECTOR =
  '.ant-draggable-panel-left-handle, .ant-draggable-panel-right-handle';

interface BrowserWebviewElement extends HTMLElement {
  getWebContentsId: () => number;
}

interface RetainedWebview {
  boundsFrame?: number;
  boundsPollTimer?: number;
  host?: HTMLElement;
  interactionBridge?: HTMLDivElement;
  lastBoundsKey?: string;
  lastUsedAt: number;
  ready: Promise<BrowserWebviewElement>;
  resizeObserver?: ResizeObserver;
  restoreInteraction?: () => void;
  syncBounds?: () => void;
  visible: boolean;
  webview: BrowserWebviewElement;
}

const getHiddenHost = () => {
  const existing = document.querySelector(`#${HIDDEN_HOST_ID}`);
  if (existing instanceof HTMLDivElement) return existing;

  const host = document.createElement('div');
  host.id = HIDDEN_HOST_ID;
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    inset: '0',
    overflow: 'visible',
    pointerEvents: 'none',
    position: 'fixed',
  });
  // Keep the guest and application overlays in the same composition subtree.
  // Electron guests can otherwise paint above a portal even when the portal has
  // a larger CSS z-index. The theme root already contains the application
  // surface when this registry is first used; appending the guest here puts it
  // above that surface, while subsequently opened portals paint above the
  // guest. The host never moves again, so the browsing context stays intact.
  const portalRoot = document.querySelector(`#${PORTAL_ROOT_ID}`);
  if (portalRoot) portalRoot.append(host);
  else document.body.append(host);
  return host;
};

class BrowserWebviewRegistry {
  private retained = new Map<string, RetainedWebview>();

  async attach(sessionId: string, host: HTMLElement): Promise<BrowserWebviewElement> {
    const webview = await this.ensure(sessionId);
    const retained = this.retained.get(sessionId);
    if (retained) {
      this.stopBoundsSync(retained);
      retained.host = host;
      retained.lastUsedAt = Date.now();
      retained.visible = true;
      retained.syncBounds = () => this.scheduleBoundsSync(retained);
      retained.resizeObserver = new ResizeObserver(retained.syncBounds);
      retained.resizeObserver.observe(host);
      window.addEventListener('resize', retained.syncBounds);
      window.addEventListener('scroll', retained.syncBounds, true);
      retained.boundsPollTimer = window.setInterval(retained.syncBounds, BOUNDS_POLL_INTERVAL_MS);
      this.mountResizeBridge(retained);
    }

    Object.assign(webview.style, {
      opacity: '1',
      pointerEvents: 'auto',
      position: 'fixed',
      zIndex: '',
    });
    if (retained) this.syncBounds(retained);
    return webview;
  }

  async detach(sessionId: string, host?: HTMLElement): Promise<void> {
    const retained = this.retained.get(sessionId);
    if (!retained) return;

    const webview = await retained.ready;
    if (host && retained.host !== host) return;

    this.stopBoundsSync(retained);
    retained.host = undefined;
    retained.lastUsedAt = Date.now();
    retained.lastBoundsKey = undefined;
    retained.visible = false;
    Object.assign(webview.style, {
      height: '800px',
      left: '-10000px',
      opacity: '0',
      pointerEvents: 'none',
      position: 'fixed',
      top: '0',
      width: '1200px',
    });
  }

  ensure(sessionId: string): Promise<BrowserWebviewElement> {
    const existing = this.retained.get(sessionId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.ready;
    }

    this.evictColdWebviews();

    const webview = document.createElement('webview') as BrowserWebviewElement;
    webview.dataset.browserSessionId = sessionId;
    webview.setAttribute('partition', BROWSER_PARTITION);
    const initialUrl = 'about:blank';
    webview.setAttribute('src', initialUrl);
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes');

    const ready = new Promise<BrowserWebviewElement>((resolve, reject) => {
      const onDestroyed = () => reject(new Error(`Browser webview was destroyed: ${sessionId}`));
      webview.addEventListener('destroyed', onDestroyed, { once: true });
      webview.addEventListener(
        'dom-ready',
        () => {
          webview.removeEventListener('destroyed', onDestroyed);
          // Electron dispatches `dom-ready` before the <webview> wrapper has
          // finished exposing its guest WebContents to getWebContentsId().
          // Leave the event stack before registering the guest with main.
          window.setTimeout(() => {
            void this.activate(sessionId, webview).then(() => resolve(webview), reject);
          }, 0);
        },
        { once: true },
      );
    });

    const retained: RetainedWebview = {
      lastUsedAt: Date.now(),
      ready,
      visible: false,
      webview,
    };
    this.retained.set(sessionId, retained);
    getHiddenHost().append(webview);
    Object.assign(webview.style, {
      height: '800px',
      left: '-10000px',
      opacity: '0',
      pointerEvents: 'none',
      position: 'fixed',
      top: '0',
      width: '1200px',
    });

    return ready;
  }

  /** Keep a background guest out of LRU eviction while an agent is driving it. */
  touch(sessionId: string): void {
    const retained = this.retained.get(sessionId);
    if (retained) retained.lastUsedAt = Date.now();
  }

  private async activate(sessionId: string, webview: BrowserWebviewElement): Promise<void> {
    const result = await ensureElectronIpc().browserSidebar.registerWebview({
      sessionId,
      webContentsId: webview.getWebContentsId(),
    });
    if (!result.success) throw new Error(result.error || 'Failed to register browser webview');
  }

  private scheduleBoundsSync(retained: RetainedWebview): void {
    if (retained.boundsFrame !== undefined) return;
    retained.boundsFrame = window.requestAnimationFrame(() => {
      retained.boundsFrame = undefined;
      this.syncBounds(retained);
    });
  }

  private stopBoundsSync(retained: RetainedWebview): void {
    retained.restoreInteraction?.();
    retained.restoreInteraction = undefined;
    retained.interactionBridge?.remove();
    retained.interactionBridge = undefined;
    retained.resizeObserver?.disconnect();
    retained.resizeObserver = undefined;
    if (retained.boundsPollTimer !== undefined) {
      window.clearInterval(retained.boundsPollTimer);
      retained.boundsPollTimer = undefined;
    }
    if (retained.syncBounds) {
      window.removeEventListener('resize', retained.syncBounds);
      window.removeEventListener('scroll', retained.syncBounds, true);
    }
    retained.syncBounds = undefined;
    if (retained.boundsFrame !== undefined) {
      window.cancelAnimationFrame(retained.boundsFrame);
      retained.boundsFrame = undefined;
    }
  }

  private syncBounds(retained: RetainedWebview): void {
    if (!retained.visible || !retained.host) return;
    const bounds = retained.host.getBoundingClientRect();
    const clippedByAncestor = this.isClippedByCollapsedAncestor(retained.host);
    const boundsKey = `${clippedByAncestor},${bounds.left},${bounds.top},${bounds.width},${bounds.height}`;
    if (retained.lastBoundsKey === boundsKey) return;
    retained.lastBoundsKey = boundsKey;

    // The draggable panel keeps its fixed-width child mounted while its clipping
    // ancestor collapses to zero. Checking the host alone therefore misses the
    // closed state and leaves the guest's last compositor frame on screen.
    if (clippedByAncestor || bounds.width <= 0 || bounds.height <= 0) {
      Object.assign(retained.webview.style, {
        height: '800px',
        left: '-10000px',
        opacity: '0',
        pointerEvents: 'none',
        top: '0',
        width: '1200px',
      });
      if (retained.interactionBridge) {
        retained.interactionBridge.style.pointerEvents = 'none';
        retained.interactionBridge.style.visibility = 'hidden';
      }
      return;
    }

    Object.assign(retained.webview.style, {
      height: `${bounds.height}px`,
      left: `${bounds.left}px`,
      opacity: '1',
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
    });
    if (!retained.restoreInteraction) retained.webview.style.pointerEvents = 'auto';
    if (retained.interactionBridge) {
      const isRtl = getComputedStyle(retained.host).direction === 'rtl';
      const bridgeLeft = isRtl ? bounds.right - RESIZE_BRIDGE_WIDTH / 2 : bounds.left - 5;
      Object.assign(retained.interactionBridge.style, {
        height: `${bounds.height}px`,
        left: `${bridgeLeft}px`,
        visibility: 'visible',
        top: `${bounds.top}px`,
      });
      if (!retained.restoreInteraction) retained.interactionBridge.style.pointerEvents = 'auto';
    }
  }

  private isClippedByCollapsedAncestor(host: HTMLElement): boolean {
    let element = host.parentElement;
    while (element && element !== document.body) {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        (bounds.width <= 0 && style.overflowX !== 'visible') ||
        (bounds.height <= 0 && style.overflowY !== 'visible')
      ) {
        return true;
      }
      element = element.parentElement;
    }
    return false;
  }

  private mountResizeBridge(retained: RetainedWebview): void {
    const overlayHost = getHiddenHost().parentElement;
    if (!overlayHost) return;

    const bridge = document.createElement('div');
    bridge.setAttribute('aria-hidden', 'true');
    bridge.dataset.browserResizeBridge = 'true';
    Object.assign(bridge.style, {
      cursor: 'col-resize',
      pointerEvents: 'auto',
      position: 'fixed',
      width: `${RESIZE_BRIDGE_WIDTH}px`,
      zIndex: '1',
    });

    const restoreInteraction = () => {
      window.removeEventListener('blur', restoreInteraction);
      window.removeEventListener('mouseup', restoreInteraction, true);
      retained.restoreInteraction = undefined;
      bridge.style.pointerEvents = 'auto';
      if (retained.visible && retained.webview.style.opacity === '1') {
        retained.webview.style.pointerEvents = 'auto';
      }
    };

    bridge.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;

      retained.webview.style.pointerEvents = 'none';
      bridge.style.pointerEvents = 'none';
      retained.restoreInteraction = restoreInteraction;

      const resizeHandle = retained.host
        ?.closest('.ant-draggable-panel')
        ?.querySelector<HTMLElement>(RESIZE_HANDLE_SELECTOR);
      if (!resizeHandle) {
        restoreInteraction();
        return;
      }

      window.addEventListener('blur', restoreInteraction, { once: true });
      window.addEventListener('mouseup', restoreInteraction, { capture: true, once: true });
      resizeHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: event.button,
          buttons: event.buttons,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
        }),
      );
    });

    overlayHost.append(bridge);
    retained.interactionBridge = bridge;
  }

  private evictColdWebviews(): void {
    if (this.retained.size < MAX_RETAINED_BROWSER_WEBVIEWS) return;

    const evictionCutoff = Date.now() - RETAINED_IN_USE_GRACE_MS;
    const candidate = [...this.retained.entries()]
      .filter(([, retained]) => !retained.visible && retained.lastUsedAt < evictionCutoff)
      .sort(([, a], [, b]) => a.lastUsedAt - b.lastUsedAt)[0];
    if (!candidate) return;

    const [sessionId, retained] = candidate;
    this.stopBoundsSync(retained);
    this.retained.delete(sessionId);
    retained.webview.remove();
  }
}

export const browserWebviewRegistry = new BrowserWebviewRegistry();
