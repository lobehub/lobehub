import type { Plugin, ViteDevServer } from 'vite';

const EVENT = 'lobe:dev-loading-progress';
const BROADCAST_INTERVAL_MS = 80;
const ESTIMATE_STORAGE_KEY = 'lobe-dev-loading-progress:total';

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

const style = `
#loading-dev-progress {
  --ldp-fg: #1f1f1f;
  position: fixed;
  inset-block-end: 16px;
  inset-inline: 0;
  z-index: 100000;
  width: min(320px, calc(100vw - 32px));
  margin-inline: auto;
  direction: ltr;
  color: var(--ldp-fg);
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms ease;
}
html[data-theme='dark'] #loading-dev-progress { --ldp-fg: #f0f0f0; }
#loading-dev-progress.ldp-shown { opacity: 0.6; }
#loading-dev-progress .ldp-head { display: flex; align-items: center; gap: 10px; }
#loading-dev-progress .ldp-track {
  position: relative;
  flex: 1;
  height: 2px;
  overflow: hidden;
  border-radius: 1px;
  background: color-mix(in srgb, currentcolor 15%, transparent);
}
#loading-dev-progress .ldp-bar {
  position: absolute;
  inset: 0;
  background: currentcolor;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 200ms ease-out;
}
#loading-dev-progress.ldp-indeterminate .ldp-bar {
  width: 30%;
  transform: none;
  animation: ldp-slide 1.2s ease-in-out infinite;
}
#loading-dev-progress .ldp-count { flex: none; min-width: 16ch; text-align: end; }
#loading-dev-progress .ldp-detail {
  margin-block-start: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.75;
}
@keyframes ldp-slide { from { translate: -100%; } to { translate: 340%; } }
@media (prefers-reduced-motion: reduce) {
  #loading-dev-progress .ldp-bar { transition: none; }
  #loading-dev-progress.ldp-indeterminate .ldp-bar { width: 100%; opacity: 0.3; animation: none; }
}
`;

const clientScript = (hmrUrl: string) => `(function () {
  var ids = ${JSON.stringify(PLACEHOLDER_IDS)};
  var storageKey = ${JSON.stringify(ESTIMATE_STORAGE_KEY)};
  var root = document.createElement('div');
  root.id = 'loading-dev-progress';
  root.innerHTML = '<div class="ldp-head"><div class="ldp-track"><div class="ldp-bar"></div></div><span class="ldp-count"></span></div><div class="ldp-detail"></div>';
  var bar = root.querySelector('.ldp-bar');
  var countEl = root.querySelector('.ldp-count');
  var detailEl = root.querySelector('.ldp-detail');
  var count = 0, file = '', start = performance.now(), lastChange = start, goneSince = 0, estimate = 0, ws;
  try { estimate = Number(localStorage.getItem(storageKey)) || 0; } catch (_) {}
  function placeholderVisible() {
    for (var i = 0; i < ids.length; i++) if (document.getElementById(ids[i])) return true;
    return false;
  }
  function fmt(n) { return n.toLocaleString('en-US'); }
  function shorten(path) {
    var parts = path.split('/');
    return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : path;
  }
  function finish() {
    clearInterval(timer);
    root.remove();
    if (ws) ws.close();
    if (count > 0) try { localStorage.setItem(storageKey, String(count)); } catch (_) {}
  }
  function render() {
    var now = performance.now();
    if (!placeholderVisible()) {
      root.classList.remove('ldp-shown');
      goneSince = goneSince || now;
      if (now - goneSince >= 500) finish();
      return;
    }
    goneSince = 0;
    if (!root.isConnected) document.body.appendChild(root);
    if (now - start >= 300) root.classList.add('ldp-shown');
    var total = estimate && Math.max(estimate, count);
    root.classList.toggle('ldp-indeterminate', !total);
    if (total) bar.style.transform = 'scaleX(' + Math.min(count / total, 0.95) + ')';
    countEl.textContent = total ? fmt(count) + ' / ~' + fmt(total) : fmt(count) + ' modules';
    var status = count === 0 ? 'waiting for vite…' : now - lastChange >= 1500 ? 'compiled · mounting app…' : shorten(file);
    detailEl.textContent = ((now - start) / 1000).toFixed(1) + 's · ' + status;
  }
  var timer = setInterval(render, 100);
  render();
  try {
    ws = new WebSocket(${JSON.stringify(hmrUrl)}, 'vite-hmr');
    ws.onmessage = function (e) {
      var m = JSON.parse(e.data);
      if (m.type !== 'custom' || m.event !== ${JSON.stringify(EVENT)}) return;
      if (m.data.count !== count) lastChange = performance.now();
      count = m.data.count;
      file = m.data.file;
    };
  } catch (_) {}
})();`;

/**
 * Dev-only: streams Vite's transform progress onto the static loading screen so a
 * cold `dev` start shows a progress bar estimated from the previous boot's module
 * count instead of a frozen logo.
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
      // A reload reuses already-transformed modules, so no broadcast would ever reach it.
      devServer.hot.on('vite:client:connect', (_data, client) => {
        if (count > 0) client.send(EVENT, { count, file: latest });
      });
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
      return [
        { children: style, injectTo: 'head', tag: 'style' },
        { children: clientScript(hmrUrl), injectTo: 'body', tag: 'script' },
      ];
    },
  };
};
