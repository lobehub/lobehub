import { reject } from './reject';

interface BundledInfo {
  aliases?: string[];
  displayName: string;
  id: string;
  name: string;
}

// `@lobehub/ui`'s Highlighter reads these catalogs at module scope, and the
// barrel puts it in every graph that touches the package. Importing the real
// `shiki` registers all ~400 bundled grammars as chunks — roughly half the
// worker's upload — for a highlighter the server never renders, since every
// code surface sits behind a `*.client` gate.
export const bundledLanguagesInfo: BundledInfo[] = [];
export const bundledThemesInfo: BundledInfo[] = [];
export const bundledLanguages: Record<string, () => Promise<unknown>> = {};

// Evaluated at module scope by theme setup, so it answers instead of throwing.
export const createCssVariablesTheme = (options?: { name?: string }) => ({
  name: options?.name ?? 'css-variables',
  settings: [],
  type: 'dark' as const,
});

export const getTokenStyleObject = () => ({});
export const stringifyTokenStyle = () => '';

// Only reachable from a render path, so hitting one means a code surface
// escaped the client gate — fail loudly rather than render unhighlighted.
export const codeToHtml = reject('shiki.codeToHtml');
export const createHighlighter = reject('shiki.createHighlighter');
export const createJavaScriptRegexEngine = reject('shiki.createJavaScriptRegexEngine');
export const createOnigurumaEngine = reject('shiki.createOnigurumaEngine');
