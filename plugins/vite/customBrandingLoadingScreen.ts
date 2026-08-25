// Deep import on purpose: the package root barrel uses extensionless relative
// imports that Node's type-stripping loader (which evaluates externalized
// config-time imports) cannot resolve. branding.ts is a dependency-free leaf
// exposed via the './branding' subpath — keep it import-free.
import { BRANDING_NAME } from '@lobechat/business-const/branding';
import type { Plugin } from 'vite';

const LOADING_BRAND_BLOCK = /<div id="loading-brand"[^>]*>[\S\s]*?<\/div>/;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * Replace the hardcoded LobeHub wordmark in the static loading screen with the
 * custom brand name, so white-label deployments (BRANDING_NAME !== 'LobeHub')
 * never flash the LobeHub logo before the SPA boots. No-op for the default
 * branding.
 */
export const customBrandingLoadingScreen = (): Plugin => ({
  name: 'custom-branding-loading-screen',
  transformIndexHtml: {
    handler(html) {
      if (BRANDING_NAME === 'LobeHub') return html;

      return html.replace(
        LOADING_BRAND_BLOCK,
        `<div id="loading-brand" aria-label="Loading" role="status" style="font-size: 26px; font-weight: 700; letter-spacing: 0.02em;">${escapeHtml(
          BRANDING_NAME,
        )}</div>`,
      );
    },
    order: 'pre',
  },
});
