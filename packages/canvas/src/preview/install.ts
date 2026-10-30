import type { CanvasPreviewProject } from '../project/snapshot';

// These functions are serialized into srcdoc; keep them independent of module scope.
export function installCanvasProjectGlobals(
  urls: Record<string, string>,
  page: string,
  owned: string[],
) {
  let disposed = false;
  const resolve = (from: string, target: string) => {
    const url = new URL(target, `https://canvas.invalid/${from}`);
    const path = decodeURIComponent(url.pathname.slice(1));
    if (url.origin !== 'https://canvas.invalid' || !urls[path])
      throw new Error(`Missing Canvas resource: ${target}`);
    return urls[path] + url.hash;
  };
  let load: ((url: string, options?: unknown) => Promise<unknown>) | undefined;
  let reject: ((cause: Error) => void) | undefined;
  const ready = new Promise<(url: string, options?: unknown) => Promise<unknown>>(
    (resolve, onError) => {
      reject = onError;
      window.addEventListener(
        'lobe-canvas-project-import',
        (event) => {
          load = (event as CustomEvent).detail;
          resolve(load!);
        },
        { once: true },
      );
    },
  );
  // Disposal may happen before any project module requests an import.
  void ready.catch(() => {});
  Reflect.set(
    window,
    '__LOBE_CANVAS_IMPORT__',
    async (from: string, target: string, options?: unknown) => {
      const url = resolve(from, String(target));
      const importModule = load ?? (await ready);
      if (disposed) throw new Error('Canvas project disposed');
      return importModule(url, options);
    },
  );
  Reflect.set(
    window,
    '__LOBE_CANVAS_URL__',
    (from: string, target: string) => new URL(resolve(from, String(target))),
  );
  const navigate = (event: MouseEvent) => {
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
    const href = anchor instanceof HTMLAnchorElement ? anchor.getAttribute('href') : undefined;
    if (href?.startsWith('#')) {
      event.preventDefault();
      document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
      return;
    }
    if (!href?.startsWith('lobe-canvas-page/')) return;
    event.preventDefault();
    const target = href.slice('lobe-canvas-page/'.length);
    window.parent.postMessage(
      {
        source: 'lobe-canvas',
        type: 'navigate',
        path: decodeURIComponent(target.split('#')[0]),
        hash: target.includes('#') ? target.slice(target.indexOf('#')) : '',
      },
      '*',
    );
  };
  document.addEventListener('click', navigate);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('click', navigate);
    for (const url of owned) URL.revokeObjectURL(url);
    owned.length = 0;
    for (const name of ['__LOBE_CANVAS_IMPORT__', '__LOBE_CANVAS_URL__'])
      Reflect.deleteProperty(window, name);
    reject?.(new Error('Canvas project disposed'));
    window.removeEventListener('lobe-canvas-dispose', dispose);
  };
  window.addEventListener('lobe-canvas-dispose', dispose);
  // Expose the original page only as a base for project-owned resource resolution.
  document.documentElement.dataset.canvasPage = page;
}

export function installCanvasProject(
  project: CanvasPreviewProject,
  page: string,
  bridgeSource: string,
  globalsSource: string,
  hash = '',
) {
  const urls: Record<string, string> = {};
  const owned: string[] = [];
  const visiting = new Set<string>();
  const serialize = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
  const create = (content: BlobPart, contentType: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: contentType }));
    owned.push(url);
    return url;
  };
  const fileUrl = (path: string): string => {
    if (urls[path]) return urls[path];
    const file = project.files[path];
    if (!file) throw new Error(`Missing Canvas file: ${path}`);
    if (visiting.has(path)) return create('', 'text/css');
    visiting.add(path);
    let content: BlobPart = file.content;
    if (file.encoding === 'base64')
      content = Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0));
    else if (path.toLowerCase().endsWith('.css')) content = replace(file.content);
    const url = create(content, file.contentType);
    urls[path] = url;
    visiting.delete(path);
    return url;
  };
  const replace = (source: string) =>
    source.replaceAll(/lobe-canvas-file\/([\w%.@-]+)/g, (_match, path: string) =>
      fileUrl(decodeURIComponent(path)),
    );
  try {
    for (const path of Object.keys(project.files))
      if (!path.toLowerCase().endsWith('.html')) fileUrl(path);
    const entry = project.files[page];
    if (!entry || !page.toLowerCase().endsWith('.html'))
      throw new Error(`Missing Canvas page: ${page}`);
    const imports = Object.fromEntries(
      Object.entries(urls).map(([path, url]) => [`lobe-canvas-project/${path}`, url]),
    );
    const injection =
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src blob:; form-action 'none'; base-uri 'none'">` +
      `<script>(${bridgeSource})();(${globalsSource})(${serialize(urls)},${serialize(page)},${serialize(owned)});</script>` +
      `<script type="importmap">${serialize({ imports })}</script>` +
      `<script type="module">window.dispatchEvent(new CustomEvent('lobe-canvas-project-import',{detail:(url,options)=>import(url,options)}));</script>` +
      (hash
        ? `<script>window.addEventListener('load',()=>document.getElementById(${serialize(decodeURIComponent(hash.slice(1)))})?.scrollIntoView(),{once:true});</script>`
        : '');
    let html = replace(entry.content);
    const head = /<head(?:\s[^>]*)?>/i.exec(html);
    if (head) {
      const at = head.index + head[0].length;
      html = html.slice(0, at) + injection + html.slice(at);
    } else
      html = `<!doctype html><html><head><meta charset="utf-8">${injection}</head><body>${html}</body></html>`;
    document.open();
    document.write(html);
    document.close();
  } catch (cause) {
    for (const url of owned) URL.revokeObjectURL(url);
    window.parent.postMessage(
      { source: 'lobe-canvas', type: 'error', message: String(cause) },
      '*',
    );
  }
}
