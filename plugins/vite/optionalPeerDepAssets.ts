import type { Plugin } from 'vite';

/**
 * Prefix Vite's resolver returns for an optional peer dependency that is not installed:
 * `__vite-optional-peer-dep:<specifier>:<importing package>`.
 */
const VITE_OPTIONAL_PEER_DEP_PREFIX = '__vite-optional-peer-dep:';

const STUB_PREFIX = '\0lobe-optional-peer-dep-asset:';

// The asset types Vite's dep optimizer externalizes instead of bundling.
const ASSET_IMPORT_RE =
  /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss|wasm|json|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|otf|eot)(?:\?.*)?$/;

/**
 * Keep asset imports of a missing optional peer dependency inside the dep pre-bundle.
 *
 * Vite (8.0 through at least 8.4) resolves a missing optional peer to a
 * `__vite-optional-peer-dep:` placeholder. For JavaScript the optimizer turns that
 * placeholder into a module that throws, but its asset branch externalizes the
 * placeholder as-is. The pre-bundled chunk then imports a specifier the dev server
 * cannot resolve, and loading the chunk fails with
 * `Failed to resolve import "__vite-optional-peer-dep:…"`.
 *
 * `@lobehub/charts` hits this: its map loader runs
 * `import('maplibre-gl/dist/maplibre-gl.css').catch(…)`, and `maplibre-gl` is an
 * optional peer the app does not install. This plugin gives such imports the same
 * throwing module Vite already uses for JavaScript, so the importer's own
 * error handling decides what happens.
 *
 * Register it in `optimizeDeps.rolldownOptions.plugins`: the optimizer runs those
 * plugins before its own resolver.
 */
export function optionalPeerDepAssets(): Plugin {
  return {
    load: {
      filter: { id: new RegExp(`^${STUB_PREFIX}`) },
      handler(id) {
        const [specifier, importer] = id.slice(STUB_PREFIX.length).split(':');

        return {
          code: `throw new Error(${JSON.stringify(
            `Could not resolve "${specifier}" imported by "${importer}". Is it installed?`,
          )});`,
          moduleSideEffects: true,
        };
      },
    },
    name: 'lobe-optional-peer-dep-assets',
    resolveId: {
      filter: { id: ASSET_IMPORT_RE },
      async handler(source, importer, options) {
        if (!importer || source.startsWith('.') || source.startsWith('/')) return null;

        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (!resolved?.id.startsWith(VITE_OPTIONAL_PEER_DEP_PREFIX)) return null;

        return { id: STUB_PREFIX + resolved.id.slice(VITE_OPTIONAL_PEER_DEP_PREFIX.length) };
      },
    },
  };
}
