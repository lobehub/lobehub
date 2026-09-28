import { afterEach, describe, expect, it, vi } from 'vitest';

import { devLoadingProgress } from './devLoadingProgress';

const createServer = (server: Record<string, unknown> = {}) => ({
  config: {
    root: '/repo',
    server: {
      hmr: { clientPort: 5173, host: '127.0.0.1' },
      host: '127.0.0.1',
      port: 5173,
      ...server,
    },
  },
  hot: { on: vi.fn(), send: vi.fn() },
});

const setup = (server = createServer()) => {
  const plugin = devLoadingProgress() as any;
  plugin.configureServer(server);
  return { plugin, server };
};

describe('devLoadingProgress', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('injects themed styles and a client script pointing at the HMR websocket', () => {
    const { plugin } = setup();

    const [styleTag, scriptTag] = plugin.transformIndexHtml();

    expect(styleTag).toMatchObject({ injectTo: 'head', tag: 'style' });
    expect(styleTag.children).toContain("html[data-theme='dark'] #loading-dev-progress");
    expect(scriptTag).toMatchObject({ injectTo: 'body', tag: 'script' });
    expect(scriptTag.children).toContain('"ws://127.0.0.1:5173"');
  });

  it('sends the current progress to a client that connects after transforms', () => {
    const { plugin, server } = setup();
    const [event, onConnect] = server.hot.on.mock.calls[0];
    const client = { send: vi.fn() };

    onConnect(undefined, client);
    expect(client.send).not.toHaveBeenCalled();

    plugin.transform('', '/repo/src/a.tsx');
    onConnect(undefined, client);

    expect(event).toBe('vite:client:connect');
    expect(client.send).toHaveBeenCalledWith('lobe:dev-loading-progress', {
      count: 1,
      file: 'src/a.tsx',
    });
  });

  it('renders estimated progress and remembers the final count once boot finishes', () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'],
    });
    const sockets: any[] = [];
    vi.stubGlobal(
      'WebSocket',
      class {
        onmessage?: (e: { data: string }) => void;
        close = vi.fn();
        constructor() {
          sockets.push(this);
        }
      },
    );
    localStorage.setItem('lobe-dev-loading-progress:total', '200');
    document.body.innerHTML = '<div id="loading-screen"></div>';
    const { plugin } = setup();
    const [, scriptTag] = plugin.transformIndexHtml();

    new Function(scriptTag.children)();
    sockets[0].onmessage({
      data: JSON.stringify({
        data: { count: 50, file: 'src/features/Chat/index.tsx' },
        event: 'lobe:dev-loading-progress',
        type: 'custom',
      }),
    });
    vi.advanceTimersByTime(400);

    const root = document.getElementById('loading-dev-progress')!;
    expect(root.classList.contains('ldp-shown')).toBe(true);
    expect(root.querySelector('.ldp-count')!.textContent).toBe('50 / ~200');
    expect((root.querySelector('.ldp-bar') as HTMLElement).style.transform).toBe('scaleX(0.25)');
    expect(root.querySelector('.ldp-detail')!.textContent).toContain('…/Chat/index.tsx');

    vi.advanceTimersByTime(1500);
    expect(root.querySelector('.ldp-detail')!.textContent).toContain('mounting app');

    document.getElementById('loading-screen')!.remove();
    vi.advanceTimersByTime(700);

    expect(root.isConnected).toBe(false);
    expect(sockets[0].close).toHaveBeenCalled();
    expect(localStorage.getItem('lobe-dev-loading-progress:total')).toBe('50');
    vi.unstubAllGlobals();
  });

  it('injects nothing when HMR is disabled', () => {
    const { plugin } = setup(createServer({ hmr: false }));

    expect(plugin.transformIndexHtml()).toEqual([]);
  });

  it('batches transforms into one throttled broadcast with root-relative ids', () => {
    vi.useFakeTimers();
    const { plugin, server } = setup();

    plugin.transform('', '/repo/src/a.tsx?v=1');
    plugin.transform('', '/repo/src/b.tsx');
    expect(server.hot.send).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(server.hot.send).toHaveBeenCalledTimes(1);
    expect(server.hot.send).toHaveBeenCalledWith({
      data: { count: 2, file: 'src/b.tsx' },
      event: 'lobe:dev-loading-progress',
      type: 'custom',
    });
  });
});
