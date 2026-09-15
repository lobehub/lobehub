import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registerWebview = vi.fn().mockResolvedValue({ success: true });

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ browserSidebar: { registerWebview } }),
}));

describe('browserWebviewRegistry', () => {
  const originalCreateElement = document.createElement.bind(document);

  const resolveWebview = async (sessionId: string) => {
    const { browserWebviewRegistry } = await import('./browserWebviewRegistry');
    const ready = browserWebviewRegistry.ensure(sessionId);
    const webview = document.querySelector<HTMLElement>(
      `webview[data-browser-session-id="${sessionId}"]`,
    );
    webview?.dispatchEvent(new Event('dom-ready'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await ready;
    return webview;
  };

  beforeEach(() => {
    vi.resetModules();
    registerWebview.mockReset().mockResolvedValue({ success: true });
    document.body.replaceChildren();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = vi.fn();
        observe = vi.fn();
      },
    );
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'webview') {
        Object.assign(element, { getWebContentsId: () => 42 });
      }
      return element;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the retained webview in its stable host while projecting visible bounds', async () => {
    const { browserWebviewRegistry } = await import('./browserWebviewRegistry');
    const portalRoot = document.createElement('div');
    portalRoot.id = 'lobe-ui-theme-app';
    const appSurface = document.createElement('div');
    portalRoot.append(appSurface);
    document.body.append(portalRoot);
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () =>
      ({
        bottom: 640,
        height: 600,
        left: 320,
        right: 680,
        top: 40,
        width: 360,
        x: 320,
        y: 40,
      }) as DOMRect;
    document.body.append(viewport);

    const attaching = browserWebviewRegistry.attach('topic-1', viewport);
    const retainedHost = document.querySelector('#lobe-browser-retained-webviews');
    const webview = retainedHost?.querySelector<HTMLElement>('webview');
    webview?.dispatchEvent(new Event('dom-ready'));
    await attaching;

    expect(webview?.parentElement).toBe(retainedHost);
    expect(retainedHost?.parentElement).toBe(portalRoot);
    expect(portalRoot.firstElementChild).toBe(appSurface);
    const resizeBridge = portalRoot.querySelector('[data-browser-resize-bridge="true"]');
    expect(retainedHost?.nextElementSibling).toBe(resizeBridge);

    const overlayPortal = document.createElement('div');
    portalRoot.append(overlayPortal);
    expect(resizeBridge?.nextElementSibling).toBe(overlayPortal);
    expect(webview?.style.left).toBe('320px');
    expect(webview?.style.top).toBe('40px');
    expect(webview?.style.width).toBe('360px');
    expect(webview?.style.height).toBe('600px');
    expect(retainedHost).toHaveStyle({ overflow: 'visible', zIndex: '' });
    expect(webview).toHaveStyle({ zIndex: '' });
    expect(registerWebview).toHaveBeenCalledOnce();

    await browserWebviewRegistry.detach('topic-1', viewport);

    expect(webview?.parentElement).toBe(retainedHost);
    expect(webview?.style.left).toBe('-10000px');
    expect(webview?.style.opacity).toBe('0');
  });

  it('resyncs fixed bounds when the host moves without resizing', async () => {
    vi.useFakeTimers();

    const { browserWebviewRegistry } = await import('./browserWebviewRegistry');
    let left = 320;
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () => ({ height: 600, left, top: 40, width: 360 }) as DOMRect;
    document.body.append(viewport);

    const attaching = browserWebviewRegistry.attach('moving-topic', viewport);
    const webview = document.querySelector<HTMLElement>('webview');
    webview?.dispatchEvent(new Event('dom-ready'));
    await vi.advanceTimersByTimeAsync(0);
    await attaching;
    expect(webview?.style.left).toBe('320px');

    left = 240;
    await vi.advanceTimersByTimeAsync(120);

    expect(webview?.style.left).toBe('240px');
    await browserWebviewRegistry.detach('moving-topic', viewport);
    vi.useRealTimers();
  });

  it('moves a zero-sized guest offscreen so its last compositor frame cannot remain visible', async () => {
    vi.useFakeTimers();

    const { browserWebviewRegistry } = await import('./browserWebviewRegistry');
    let width = 360;
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () =>
      ({ height: 600, left: 320, right: 320 + width, top: 40, width }) as DOMRect;
    document.body.append(viewport);

    const attaching = browserWebviewRegistry.attach('collapsing-topic', viewport);
    const webview = document.querySelector<HTMLElement>('webview');
    webview?.dispatchEvent(new Event('dom-ready'));
    await vi.advanceTimersByTimeAsync(0);
    await attaching;
    expect(webview).toHaveStyle({ left: '320px', opacity: '1', width: '360px' });

    width = 0;
    await vi.advanceTimersByTimeAsync(120);

    const bridge = document.querySelector<HTMLElement>('[data-browser-resize-bridge="true"]');
    expect(webview).toHaveStyle({ left: '-10000px', opacity: '0', width: '1200px' });
    expect(bridge).toHaveStyle({ pointerEvents: 'none', visibility: 'hidden' });

    width = 360;
    await vi.advanceTimersByTimeAsync(120);

    expect(webview).toHaveStyle({ left: '320px', opacity: '1', width: '360px' });
    expect(bridge).toHaveStyle({ pointerEvents: 'auto', visibility: 'visible' });

    await browserWebviewRegistry.detach('collapsing-topic', viewport);
    vi.useRealTimers();
  });

  it('moves the guest offscreen when a collapsed ancestor clips a fixed-width host', async () => {
    vi.useFakeTimers();

    const { browserWebviewRegistry } = await import('./browserWebviewRegistry');
    let panelWidth = 360;
    const panel = document.createElement('aside');
    panel.style.overflow = 'hidden';
    panel.getBoundingClientRect = () =>
      ({ height: 600, left: 320, top: 40, width: panelWidth }) as DOMRect;
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () =>
      ({ height: 600, left: 320, right: 680, top: 40, width: 360 }) as DOMRect;
    panel.append(viewport);
    document.body.append(panel);

    const attaching = browserWebviewRegistry.attach('clipped-topic', viewport);
    const webview = document.querySelector<HTMLElement>('webview');
    webview?.dispatchEvent(new Event('dom-ready'));
    await vi.advanceTimersByTimeAsync(0);
    await attaching;
    expect(webview).toHaveStyle({ left: '320px', opacity: '1', width: '360px' });

    panelWidth = 0;
    await vi.advanceTimersByTimeAsync(120);

    expect(webview).toHaveStyle({ left: '-10000px', opacity: '0', width: '1200px' });

    panelWidth = 360;
    await vi.advanceTimersByTimeAsync(120);

    expect(webview).toHaveStyle({ left: '320px', opacity: '1', width: '360px' });

    await browserWebviewRegistry.detach('clipped-topic', viewport);
    vi.useRealTimers();
  });

  it('forwards edge drags to the panel resize handle without shrinking the webview', async () => {
    const { browserWebviewRegistry } = await import('./browserWebviewRegistry');
    const portalRoot = document.createElement('div');
    portalRoot.id = 'lobe-ui-theme-app';
    document.body.append(portalRoot);
    const draggablePanel = document.createElement('aside');
    draggablePanel.className = 'ant-draggable-panel';
    draggablePanel.getBoundingClientRect = () =>
      ({ height: 600, left: 320, right: 680, top: 40, width: 360 }) as DOMRect;
    document.body.append(draggablePanel);
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () =>
      ({ height: 600, left: 320, right: 680, top: 40, width: 360 }) as DOMRect;
    draggablePanel.append(viewport);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'ant-draggable-panel-left-handle';
    draggablePanel.append(resizeHandle);
    const forwardedMouseDown = vi.fn();
    resizeHandle.addEventListener('mousedown', forwardedMouseDown);

    const attaching = browserWebviewRegistry.attach('resizable-topic', viewport);
    const webview = document.querySelector<HTMLElement>('webview');
    webview?.dispatchEvent(new Event('dom-ready'));
    await attaching;

    const bridge = document.querySelector<HTMLElement>('[data-browser-resize-bridge="true"]');
    expect(bridge).not.toBeNull();
    expect(webview?.style.left).toBe('320px');
    expect(webview?.style.width).toBe('360px');

    bridge?.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: 320,
        clientY: 200,
      }),
    );

    expect(forwardedMouseDown).toHaveBeenCalledOnce();
    expect(webview?.style.pointerEvents).toBe('none');

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(webview?.style.pointerEvents).toBe('auto');

    await browserWebviewRegistry.detach('resizable-topic', viewport);
    expect(document.querySelector('[data-browser-resize-bridge="true"]')).toBeNull();
  });

  it('does not evict a recently touched hidden webview', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { browserWebviewRegistry, MAX_RETAINED_BROWSER_WEBVIEWS } =
      await import('./browserWebviewRegistry');

    for (let index = 0; index < MAX_RETAINED_BROWSER_WEBVIEWS; index++) {
      now = index;
      await resolveWebview(`topic-${index}`);
    }

    now = 120_000;
    browserWebviewRegistry.touch('topic-0');
    await resolveWebview('topic-new');

    expect(document.querySelector('webview[data-browser-session-id="topic-0"]')).not.toBeNull();
    expect(document.querySelector('webview[data-browser-session-id="topic-1"]')).toBeNull();
    expect(document.querySelector('webview[data-browser-session-id="topic-new"]')).not.toBeNull();
  });
});
