import type { Plugin, ViteDevServer } from 'vite';

const EVENT = 'lobe:dev-loading-progress';
const BROADCAST_INTERVAL_MS = 80;

const resolveHmrUrl = (server: ViteDevServer) => {
  const { hmr, host, port } = server.config.server;
  if (hmr === false) return;
  const options = typeof hmr === 'object' ? hmr : {};
  const wsHost = options.host ?? (typeof host === 'string' ? host : 'localhost');
  const wsPort = options.clientPort ?? options.port ?? port;
  return `${options.protocol ?? 'ws'}://${wsHost}:${wsPort}`;
};

// Lives as long as any boot placeholder is on screen: the static `#loading-screen`,
// then the React boot shell / route fallback skeletons that follow it in dev.
const PLACEHOLDER_IDS = ['loading-screen', 'boot-shell', 'app-shell-fallback'];

const clientScript = (hmrUrl: string) => `(function () {
  var ids = ${JSON.stringify(PLACEHOLDER_IDS)};
  var el = document.createElement('div');
  el.id = 'loading-dev-progress';
  el.style.cssText = 'position: fixed; inset-block-end: 12px; inset-inline: 0; z-index: 100000; pointer-events: none; text-align: center; font: 12px ui-monospace, monospace; opacity: 0.55; white-space: nowrap;';
  var count = 0, file = '', start = performance.now();
  function placeholderVisible() {
    for (var i = 0; i < ids.length; i++) if (document.getElementById(ids[i])) return true;
    return false;
  }
  function render() {
    var visible = placeholderVisible();
    if (visible && !el.isConnected) document.body.appendChild(el);
    if (!visible && el.isConnected) el.remove();
    if (visible) el.textContent = 'vite dev · ' + count + ' modules · ' + ((performance.now() - start) / 1000).toFixed(1) + 's · ' + file;
    requestAnimationFrame(render);
  }
  render();
  try {
    var ws = new WebSocket(${JSON.stringify(hmrUrl)}, 'vite-hmr');
    ws.onmessage = function (e) {
      var m = JSON.parse(e.data);
      if (m.type === 'custom' && m.event === ${JSON.stringify(EVENT)}) { count = m.data.count; file = m.data.file; }
    };
  } catch (_) {}
})();`;

/**
 * Dev-only: streams Vite's transform progress onto the static loading screen so a
 * cold `dev` start shows "N modules · Xs · current file" instead of a frozen logo.
 */
export const devLoadingProgress = (): Plugin => {
  let server: ViteDevServer | undefined;
  let count = 0;
  let latest = '';
  let timer: NodeJS.Timeout | undefined;

  const scheduleBroadcast = () => {
    if (timer || !server) return;
    timer = setTimeout(() => {
      timer = undefined;
      server?.hot.send({ data: { count, file: latest }, event: EVENT, type: 'custom' });
    }, BROADCAST_INTERVAL_MS);
  };

  return {
    apply: 'serve',
    configureServer(devServer) {
      server = devServer;
    },
    name: 'dev-loading-progress',
    transform(_code, id) {
      if (!server) return;
      count += 1;
      latest = id.split('?')[0].replace(server.config.root, '').replace(/^\//, '');
      scheduleBroadcast();
    },
    transformIndexHtml() {
      const hmrUrl = server && resolveHmrUrl(server);
      if (!hmrUrl) return [];
      return [{ children: clientScript(hmrUrl), injectTo: 'body', tag: 'script' }];
    },
  };
};
