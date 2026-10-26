import type { CanvasRuntimeBundle } from './types';

// Serialized into preview HTML: keep this function self-contained.
export function installCanvasBridge() {
  const host = window.parent;
  const instanceId = `${Date.now()}-${Math.random()}`;
  const urls = new Set<string>();
  const nodes = new Set<HTMLElement>();
  const imports: Record<string, string> = {};
  const styles = new Set<string>();
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (cause: Error) => void }
  >();
  let requestId = 0;
  let importModule: ((url: string) => Promise<unknown>) | undefined;
  let started = false;
  let disposed = false;
  let observer: ResizeObserver | undefined;
  const post = (message: Record<string, unknown>) => {
    if (host !== window) host.postMessage({ ...message, instanceId, source: 'lobe-canvas' }, '*');
  };
  const ready = () => post({ type: 'ready' });
  const error = (message: string) => post({ message, type: 'error' });
  const append = (node: HTMLElement) => {
    nodes.add(node);
    document.head.append(node);
  };
  const objectUrl = (code: string) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    urls.add(url);
    return url;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.dispatchEvent(new Event('lobe-canvas-dispose'));
    observer?.disconnect();
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    for (const node of nodes) node.remove();
    nodes.clear();
    Reflect.deleteProperty(window, '__LOBE_CANVAS_LOAD_ADDON__');
    for (const request of pending.values()) request.reject(new Error('Canvas runtime disposed'));
    pending.clear();
    styles.clear();
    for (const id of Object.keys(imports)) delete imports[id];
    importModule = undefined;
  };
  const install = (bundle: CanvasRuntimeBundle) => {
    for (const css of bundle.styles) {
      if (styles.has(css)) continue;
      styles.add(css);
      const style = document.createElement('style');
      style.textContent = css;
      append(style);
    }
    const added: Record<string, string> = {};
    for (const module of bundle.modules) {
      if (imports[`lobe-canvas/${module.id}`]) continue;
      const edits = [
        ...module.imports.map(({ start, end, target }) => ({
          start,
          end,
          text: JSON.stringify(`lobe-canvas/${target}`),
        })),
        ...(module.meta ?? []).map(({ start, end }) => ({
          start,
          end,
          text: JSON.stringify(module.url),
        })),
      ].sort((a, b) => b.start - a.start);
      let code = module.code;
      for (const edit of edits) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
      added[`lobe-canvas/${module.id}`] = objectUrl(code);
    }
    const map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({ imports: added });
    append(map);
    Object.assign(imports, added);
    return imports;
  };
  const start = (bundle: CanvasRuntimeBundle) => {
    if (started || disposed) return;
    started = true;
    try {
      install(bundle);
      Reflect.set(
        window,
        '__LOBE_CANVAS_LOAD_ADDON__',
        (name: string) =>
          new Promise((resolve, reject) => {
            const id = ++requestId;
            pending.set(id, { resolve, reject });
            post({ type: 'load-addon', name, requestId: id });
          }),
      );
      const script = document.createElement('script');
      script.type = 'module';
      const entries = Object.fromEntries(
        Object.entries(bundle.entries).map(([name, id]) => [name, imports[`lobe-canvas/${id}`]]),
      );
      script.src = objectUrl(`const entries = ${JSON.stringify(entries)};
window.dispatchEvent(new CustomEvent("lobe-canvas-import", { detail: url => import(url) }));
await import(entries.runtime);
window.parent.postMessage({ source: 'lobe-canvas', type: 'runtime-loaded', instanceId: ${JSON.stringify(instanceId)} }, '*');`);
      script.addEventListener(
        'error',
        () => {
          error('Canvas runtime failed to load');
          dispose();
        },
        { once: true },
      );
      append(script);
    } catch (cause) {
      error(cause instanceof Error ? cause.message : String(cause));
      dispose();
    }
  };
  window.addEventListener(
    'lobe-canvas-import',
    (event) => {
      importModule = (event as CustomEvent).detail;
    },
    { once: true },
  );
  window.addEventListener('message', (event) => {
    if (disposed) return;
    if (event.source !== host || event.data?.source !== 'lobe-canvas-host') return;
    const message = event.data;
    if (message.type === 'request-runtime') ready();
    if (message.type === 'theme') {
      Reflect.set(window, '__LOBE_CANVAS_THEME__', message.theme);
      window.dispatchEvent(new CustomEvent('lobe-canvas-theme', { detail: message.theme }));
    }
    if (message.instanceId !== instanceId) return;
    if (message.type === 'runtime') start(message.bundle);
    if (message.type === 'addon') {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      if (message.error) request.reject(new Error(message.error));
      else {
        try {
          install(message.bundle);
          request.resolve(
            importModule!(imports[`lobe-canvas/${message.bundle.entries[message.name]}`]),
          );
        } catch (cause) {
          request.reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      }
    }
    if (message.type === 'dispose-runtime') dispose();
  });
  window.addEventListener('error', (event) =>
    error(String(event.message || event.error || 'Script error')),
  );
  window.addEventListener('unhandledrejection', (event) =>
    error(String(event.reason?.message ?? event.reason)),
  );
  window.addEventListener('lobe-canvas-component-error', (event) => {
    const detail = (event as CustomEvent).detail;
    post({ type: 'error', message: detail?.message, component: detail?.tag });
  });
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) dispose();
  });
  window.addEventListener(
    'load',
    () => {
      ready();
      const size = () => post({ type: 'height', height: document.documentElement.scrollHeight });
      size();
      observer = new ResizeObserver(size);
      observer.observe(document.documentElement);
    },
    { once: true },
  );
}
