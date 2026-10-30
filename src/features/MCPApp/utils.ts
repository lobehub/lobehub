import type { MessageMetadata } from '@lobechat/types';
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/client';
import type {
  McpUiResourceCsp,
  McpUiResourceMeta,
} from '@modelcontextprotocol/ext-apps/app-bridge';

import type { MCPToolCallResult } from '@/libs/mcp/types';

export interface McpAppResource {
  html: string;
  meta?: McpUiResourceMeta;
}

const decodeBase64 = (value: string) => {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/**
 * Pick the HTML document out of a `resources/read` result. Prefers the entry
 * matching `uri`; accepts text or base64 blob contents.
 */
export const pickAppResource = (
  result: ReadResourceResult | undefined,
  uri: string,
): McpAppResource | undefined => {
  const contents = result?.contents ?? [];
  const content = contents.find((item) => item.uri === uri) ?? contents[0];
  if (!content) return;

  let html: string | undefined;
  if ('text' in content && typeof content.text === 'string') html = content.text;
  else if ('blob' in content && typeof content.blob === 'string') html = decodeBase64(content.blob);
  if (!html) return;

  const meta = (content._meta as { ui?: McpUiResourceMeta } | undefined)?.ui;

  return { html, meta };
};

/** Only http(s) origins without CSP-breaking characters make it into the policy. */
const sanitizeSources = (sources: string[] | undefined) =>
  (sources ?? []).filter((source) => /^(?:https?|wss?):\/\/[\w*.:-]+(?:\/[\w./-]*)?$/.test(source));

/**
 * CSP for the view document, built from the domains the resource declares.
 * Undeclared means no network access, per the MCP Apps spec.
 */
export const buildAppCsp = (csp: McpUiResourceCsp | undefined): string => {
  const resources = sanitizeSources(csp?.resourceDomains).join(' ');
  const connect = sanitizeSources(csp?.connectDomains).join(' ');
  const frames = sanitizeSources(csp?.frameDomains).join(' ');
  const inline = `'unsafe-inline'`;

  return [
    `default-src 'none'`,
    `script-src ${inline} ${resources}`.trim(),
    `style-src ${inline} ${resources}`.trim(),
    `img-src data: blob: ${resources}`.trim(),
    `font-src data: ${resources}`.trim(),
    `media-src data: blob: ${resources}`.trim(),
    `connect-src ${connect || `'none'`}`,
    `frame-src ${frames || `'none'`}`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ].join('; ');
};

/**
 * The view iframe's `allow` policy: these features stay off whatever the
 * resource's `_meta.ui.permissions` declares. Nothing asks the user before a
 * view would use them (desktop grants any request in the main window, and on
 * the web a grant to LobeHub covers every later view), so a server's
 * declaration alone must not reach the camera, microphone, location or
 * clipboard.
 */
export const APP_IFRAME_ALLOW = [
  `camera 'none'`,
  `microphone 'none'`,
  `geolocation 'none'`,
  `clipboard-write 'none'`,
].join('; ');

const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

/**
 * Put the CSP `<meta>` ahead of every byte the app controls; a policy declared
 * after a script would not apply to that script. Searching the app's markup for
 * its `<head>` is not safe: a `<head>` inside a comment, or a script before the
 * real head, would run unrestricted.
 *
 * The parser places the leading `<meta>` in the implied `<head>`, where the
 * policy applies, and merges the app's own `<html>`/`<head>` into those
 * elements. Its doctype would then be ignored, so ours keeps standards mode.
 */
export const injectCsp = (html: string, csp: string): string =>
  `<!doctype html><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">${html}`;

/**
 * The message a view posts (`ui/message`), tagged with the view so its bubble
 * reads as a follow-up from that view rather than something the user typed.
 */
export const toAppMessage = (
  text: string,
  identifier: string,
): { message: string; metadata: Pick<MessageMetadata, 'mcpAppSource'> } => ({
  message: text,
  metadata: { mcpAppSource: { identifier } },
});

/** Map LobeHub's tool call envelope back to the MCP `CallToolResult` a view expects. */
export const toCallToolResult = (
  result:
    | (Pick<MCPToolCallResult, 'content' | 'success'> & { state?: MCPToolCallResult['state'] })
    | undefined,
): CallToolResult => {
  const state = result?.state as (CallToolResult & { mcpApp?: unknown }) | undefined;

  if (!state || !Array.isArray(state.content)) {
    return {
      content: [{ text: result?.content ?? '', type: 'text' }],
      isError: result ? !result.success : true,
    };
  }

  const { mcpApp: _mcpApp, ...rest } = state;
  void _mcpApp;

  return rest;
};
