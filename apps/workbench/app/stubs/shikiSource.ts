const LANG_OR_THEME = /(?:^|\/)(?:langs-bundle|themes)(?:[-.]|$)/;
const WASM = /wasm(?:-inlined)?|onig\.wasm/;

export const isShikiSource = (source: string, importer?: string) => {
  if (source.startsWith('@shikijs/langs') || source.startsWith('@shikijs/themes')) return true;
  if (source === 'shiki/wasm' || source.startsWith('shiki/wasm')) return true;

  const normalized = source.replaceAll('\\', '/');
  if (normalized.includes('/node_modules/@shikijs/langs/')) return true;
  if (normalized.includes('/node_modules/@shikijs/themes/')) return true;
  if (normalized.includes('/node_modules/shiki/dist/wasm')) return true;
  if (normalized.includes('/node_modules/@shikijs/engine-oniguruma/') && WASM.test(normalized))
    return true;

  const from = (importer ?? '').replaceAll('\\', '/');
  if (from.includes('/node_modules/@shikijs/engine-oniguruma/') && WASM.test(normalized))
    return true;
  if (!from.includes('/node_modules/shiki/')) return false;
  return LANG_OR_THEME.test(normalized) || WASM.test(normalized);
};
