import { describe, expect, it, vi } from 'vitest';

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
  hot: { send: vi.fn() },
});

const setup = (server = createServer()) => {
  const plugin = devLoadingProgress() as any;
  plugin.configureServer(server);
  return { plugin, server };
};

describe('devLoadingProgress', () => {
  it('injects a client script pointing at the HMR websocket', () => {
    const { plugin } = setup();

    const [tag] = plugin.transformIndexHtml();

    expect(tag.tag).toBe('script');
    expect(tag.children).toContain('"ws://127.0.0.1:5173"');
    expect(tag.children).toContain('loading-dev-progress');
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
    vi.useRealTimers();
  });
});
