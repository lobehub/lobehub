import type { CanvasRuntimeBundle, CanvasRuntimeManifest } from '@lobechat/canvas/runtime';

export type CanvasRuntimeEntry = keyof CanvasRuntimeManifest['entries'];
export interface CanvasRuntimeSource {
  dispose: () => void;
  load: (entry: CanvasRuntimeEntry) => Promise<CanvasRuntimeBundle>;
}

export const createCanvasRuntimeSource = (
  url: URL,
  signal: AbortSignal,
  deployment?: string,
): CanvasRuntimeSource => {
  const cache = new Map<string, Promise<string>>();
  const bundles = new Set<CanvasRuntimeBundle>();
  const text = (url: URL) => {
    const key = url.href;
    let pending = cache.get(key);
    if (!pending) {
      pending = fetch(url, { signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Canvas runtime: ${response.status} ${url.pathname}`);
          return response.text();
        })
        .catch((error) => {
          cache.delete(key);
          throw error;
        });
      cache.set(key, pending);
    }
    return pending;
  };
  return {
    dispose() {
      cache.clear();
      for (const bundle of bundles) {
        bundle.modules.length = 0;
        bundle.styles.length = 0;
      }
      bundles.clear();
    },
    async load(entry) {
      const manifest: CanvasRuntimeManifest | { bundle: CanvasRuntimeBundle } = JSON.parse(
        await text(url),
      );
      signal.throwIfAborted();
      if ('bundle' in manifest) {
        bundles.add(manifest.bundle);
        return manifest.bundle;
      }
      const base = new URL(manifest.base, url);
      const assetUrl = (id: string) => {
        const asset = new URL(id, base);
        if (deployment) asset.searchParams.set('dpl', deployment);
        return asset;
      };
      const graph = new Map(manifest.modules.map((module) => [module.id, module]));
      const selected = new Set<string>();
      const visit = (id: string) => {
        if (selected.has(id)) return;
        selected.add(id);
        const module = graph.get(id);
        if (!module) throw new Error(`Canvas module missing: ${id}`);
        for (const dependency of module.imports) visit(dependency.target);
      };
      visit(manifest.entries[entry]);
      const [modules, styles] = await Promise.all([
        Promise.all(
          [...selected].map(async (id) => {
            const module = graph.get(id)!;
            const url = assetUrl(id);
            return { ...module, code: await text(url), url: url.href };
          }),
        ),
        Promise.all(
          (manifest.entryStyles?.[entry] ?? manifest.styles).map(async (id) => {
            const url = assetUrl(id);
            return (await text(url)).replaceAll(
              /url\((['"]?)(?!data:|blob:|#)([^)'"\s]+)\1\)/g,
              (_match, _quote: string, value: string) =>
                `url(${JSON.stringify(new URL(value, url).href)})`,
            );
          }),
        ),
      ]);
      signal.throwIfAborted();
      const bundle = { entries: manifest.entries, modules, styles };
      bundles.add(bundle);
      return bundle;
    },
  };
};
