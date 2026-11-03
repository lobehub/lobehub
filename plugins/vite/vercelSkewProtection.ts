/**
 * Vite plugin: Vercel Skew Protection
 *
 * Injects ?dpl=<VERCEL_DEPLOYMENT_ID> into built asset URLs so Vercel Edge
 * routes requests to the correct deployment, preventing "Failed to fetch
 * dynamically imported module" errors caused by version skew.
 *
 * Coverage:
 *   1. static import/export — renderChunk (post-enforce, after Vite internals)
 *   2. dynamic import()     — renderChunk
 *   3. CSS url()            — generateBundle
 *   4. HTML <script>/<link> — transformIndexHtml
 *   5. Web Worker URLs      — renderChunk
 *   6. __vite__mapDeps      — renderChunk (preload deps array)
 *
 * Why enforce:'post'?
 *   Vite's buildImportAnalysisPlugin rewrites dynamic imports in its own
 *   renderChunk hook. Using renderDynamicImport is ineffective because Vite
 *   regenerates the import() expressions afterward. By running post-enforce,
 *   our renderChunk sees the FINAL chunk code and can reliably modify it.
 *
 * Prerequisite: Enable Skew Protection in Vercel Dashboard.
 */

import type { Plugin } from 'vite';

export function vercelSkewProtection(deploymentId?: string): Plugin {
  const id = deploymentId || process.env.VERCEL_DEPLOYMENT_ID || '';
  let enabled = false;
  const dplParam = `dpl=${id}`;

  function appendDpl(url: string): string {
    if (url.includes('dpl=')) return url;
    return url + (url.includes('?') ? '&' : '?') + dplParam;
  }

  return {
    name: 'vite-plugin-vercel-skew-protection',
    enforce: 'post',

    // ── 0. Only active in production builds with a valid deployment ID ──
    config(_, env) {
      enabled = env.command === 'build' && id.length > 0;
      if (!enabled) return;
      return {
        define: {
          'import.meta.env.VITE_VERCEL_DEPLOYMENT_ID': JSON.stringify(id),
        },
      };
    },

    // ── 1+2. Rewrite JS chunks (runs AFTER Vite's internal plugins) ──
    renderChunk(code) {
      if (!enabled) return;

      let modified = code;
      let changed = false;

      // 1a. Rewrite static import/export declarations
      //
      // After Vite processing, static imports/exports between chunks look like:
      //   import { x } from "./chunk-hash.js";
      //   import "./chunk-hash.js";
      //   export { foo } from "./chunk-hash.js";
      // We append ?dpl= to the specifier so browsers request the correct deployment.
      const staticImportRe =
        /((?:import|export)\s*(?:\{[^}]*\}\s*from\s*)?["'])(\.\.?\/[^"']+)(["'])/g;
      modified = modified.replaceAll(
        staticImportRe,
        (_, before: string, path: string, after: string) => {
          changed = true;
          return before + appendDpl(path) + after;
        },
      );

      // 1b. Rewrite dynamic import() with relative paths
      //
      // After Vite processing, dynamic imports look like:
      //   import("./chunk-hash.js")
      // We append ?dpl= directly to the specifier.
      const importRe = /(import\(["'])(\.\.?\/[^"']+)(["']\))/g;
      modified = modified.replaceAll(importRe, (_, before: string, path: string, after: string) => {
        changed = true;
        return before + appendDpl(path) + after;
      });

      // 1c. Rewrite __vite__mapDeps dep array
      //
      // Vite 7 format:
      //   const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[
      //     "assets/index-BN2fWmdo.js","vendor/vendor-motion-xxx.js",...
      //   ])))=>i.map(i=>d[i]);
      const mapDepsRe = /(m\.f\|\|\(m\.f=\[)([\s\S]*?)(\]\))/g;
      modified = modified.replaceAll(
        mapDepsRe,
        (_, before: string, paths: string, after: string) => {
          const rewritten = paths.replaceAll(/"([^"]+)"/g, (_m: string, p: string) => {
            return `"${appendDpl(p)}"`;
          });
          changed = true;
          return before + rewritten + after;
        },
      );

      // 1d. Rewrite Worker URLs
      //   new Worker(new URL("./worker-hash.js", import.meta.url))
      const workerRe = /(new\s+(?:Shared)?Worker\(\s*new\s+URL\(\s*")([^"]+)(")/g;
      modified = modified.replaceAll(workerRe, (_, before: string, path: string, after: string) => {
        changed = true;
        return before + appendDpl(path) + after;
      });

      if (changed) return { code: modified, map: null };
    },

    // ── 2. Rewrite CSS url() references ──
    generateBundle(_, bundle) {
      if (!enabled) return;
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (
          asset.type !== 'asset' ||
          !fileName.endsWith('.css') ||
          typeof asset.source !== 'string'
        )
          continue;

        // Match url("...") or url('...') or url(...) — avoid data:/blob:/#
        const urlRe = /url\(["'](?!data:|#|blob:)([^"']+)["']\)|url\((?!data:|#|blob:)([^)]+)\)/g;
        asset.source = asset.source.replaceAll(urlRe, (match, quoted: string, bare: string) => {
          const url = quoted || bare;
          if (!url || url.includes('dpl=')) return match;
          return match.replace(url, appendDpl(url));
        });
      }
    },

    // ── 3. Rewrite HTML <script src> and <link href> ──
    transformIndexHtml(html) {
      if (!enabled) return;
      // <script ... src="...">
      html = html.replaceAll(
        /(<script[^>]+src=["'])([^"']+)(["'][^>]*>)/g,
        (match, before, src, after) => {
          if (src.startsWith('data:') || src.includes('dpl=')) return match;
          return `${before}${appendDpl(src)}${after}`;
        },
      );
      // <link rel="stylesheet|modulepreload" href="...">
      html = html.replaceAll(
        /(<link[^>]+href=["'])([^"']+)(["'][^>]*>)/g,
        (match, before, href, after) => {
          if (href.startsWith('data:') || href.includes('dpl=')) return match;
          if (!match.includes('stylesheet') && !match.includes('modulepreload')) return match;
          return `${before}${appendDpl(href)}${after}`;
        },
      );
      return html;
    },
  };
}
