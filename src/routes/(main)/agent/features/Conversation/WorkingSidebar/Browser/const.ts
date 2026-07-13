export const BROWSER_WEBVIEW_SESSION_ATTRIBUTE = 'data-lobe-browser-session-id';
export const BROWSER_IMPORT_BANNER_DISMISSED_STORAGE_KEY =
  'lobechat:desktop:browser-import-banner:dismissed:v1';
/**
 * Must stay in sync with BROWSER_PARTITION in the main-process
 * BrowserSidebarCtr — the partition attribute is how `will-attach-webview`
 * recognizes (and hardens) browser sidebar webviews.
 */
export const BROWSER_WEBVIEW_PARTITION = 'persist:lobe-browser-app';
export const DEFAULT_BROWSER_URL = 'https://www.bing.com';
