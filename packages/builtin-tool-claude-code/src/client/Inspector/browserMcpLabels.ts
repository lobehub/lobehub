// Label utilities for the in-app browser tools CC reaches through the desktop's
// builtin MCP server (`mcp__lobe_cc__browser_*`, mounted by
// `apps/desktop/.../browserMcpTools.ts`).
//
// Kept free of React / antd-style / lucide imports — same reason as
// `linearMcpLabels`: the workflow-summary path (`toolDisplayNames.ts`) pulls
// `formatBrowserMcpShortLabel` and must not drag the inspector component in.

/** MCP server name the desktop registers; CC prefixes every tool with it. */
export const BROWSER_MCP_PREFIX = 'mcp__lobe_cc__';

/**
 * Wire tool name (minus the prefix) → `BrowserManifest.api` name. The MCP tools
 * use snake_case names while the underlying browser api is camelCase, so this
 * map is also what lets one inspector / render pair key off a stable api name.
 */
const TOOL_TO_API = {
  browser_click: 'click',
  browser_fill: 'fill',
  browser_navigate: 'navigate',
  browser_press: 'press',
  browser_read_page: 'readPage',
  browser_screenshot: 'screenshot',
  browser_scroll: 'scroll',
  browser_snapshot: 'snapshot',
} as const;

export type BrowserMcpApi = (typeof TOOL_TO_API)[keyof typeof TOOL_TO_API];

/** Full CC-facing tool names, e.g. `mcp__lobe_cc__browser_navigate`. */
export const BROWSER_MCP_TOOL_NAMES: string[] = Object.keys(TOOL_TO_API).map(
  (tool) => `${BROWSER_MCP_PREFIX}${tool}`,
);

/** `mcp__lobe_cc__browser_navigate` → `navigate`; anything else → undefined. */
export const parseBrowserMcpApi = (apiName: string): BrowserMcpApi | undefined => {
  if (!apiName.startsWith(BROWSER_MCP_PREFIX)) return undefined;
  const tool = apiName.slice(BROWSER_MCP_PREFIX.length);
  return TOOL_TO_API[tool as keyof typeof TOOL_TO_API];
};

export const isBrowserMcpApiName = (apiName: string): boolean => !!parseBrowserMcpApi(apiName);

/**
 * English source strings, doubling as the `defaultValue` for the `chat` locale
 * keys — so a locale that hasn't been filled in yet still reads as a sentence
 * instead of `mcp__lobe_cc__browser_read_page`.
 */
const API_LABELS: Record<BrowserMcpApi, string> = {
  click: 'Click element',
  fill: 'Fill input',
  navigate: 'Open page',
  press: 'Press key',
  readPage: 'Read page text',
  screenshot: 'Screenshot page',
  scroll: 'Scroll page',
  snapshot: 'Snapshot page',
};

export const browserMcpLabelKey = (api: BrowserMcpApi): string =>
  `workingPanel.browser.tool.${api}`;

export const browserMcpLabelFallback = (api: BrowserMcpApi): string => API_LABELS[api];

/** Translate one `chat`-namespace key with its English fallback. */
export type BrowserMcpTranslate = (key: string, defaultValue: string) => string;

/**
 * Short label for a browser MCP call, or null when `apiName` isn't one. Takes
 * the translator so this module stays i18n-agnostic: the inspector passes
 * react-i18next's `t`, the workflow summary passes the global `i18next.t`.
 */
export const formatBrowserMcpShortLabel = (
  apiName: string,
  translate: BrowserMcpTranslate,
): string | null => {
  const api = parseBrowserMcpApi(apiName);
  if (!api) return null;
  return translate(browserMcpLabelKey(api), browserMcpLabelFallback(api));
};
