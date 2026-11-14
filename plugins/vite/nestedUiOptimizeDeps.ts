/**
 * Nested `@lobehub/ui` dependencies the web dev server has to pre-bundle on its own.
 *
 * Web rewrites `@lobehub/ui` imports to individual ESM modules and keeps the root barrel out of
 * the optimizer, so the dependencies below are served raw. Served raw, a bare import inside them
 * is rewritten to the single optimized copy of that package rather than the version they depend
 * on. Listing one here gives it its own pre-bundled copy, resolved against its own nested
 * versions.
 */
export const nestedUiOptimizeDeps: string[] = [
  // Excluded ESM UI modules still need their nested CommonJS shims optimized.
  '@lobehub/ui > use-sync-external-store/shim',
  '@lobehub/ui > use-sync-external-store/shim/with-selector',
  '@lobehub/ui > lru_map',
  '@lobehub/ui > style-to-js',
  '@lobehub/ui > @primer/octicons',
  '@lobehub/ui > extend',
  '@lobehub/ui > dayjs/plugin/advancedFormat.js',
  '@lobehub/ui > dayjs/plugin/customParseFormat.js',
  '@lobehub/ui > dayjs/plugin/localeData.js',
  '@lobehub/ui > dayjs/plugin/weekday.js',
  '@lobehub/ui > dayjs/plugin/weekOfYear.js',
  '@lobehub/ui > dayjs/plugin/weekYear.js',
  // Its bare `mdast-util-to-markdown` import would otherwise be rewritten to the single optimized
  // copy, the 2.1.2 the workspace pins, which has no attention API the CJK serializer needs
  // ("Expected a handler with the attention API" on any emphasis). Pre-bundled, it resolves its
  // own nested 2.2.
  '@lobehub/ui > remark-cjk-friendly',
];
