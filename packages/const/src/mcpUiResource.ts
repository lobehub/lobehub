/**
 * MCP-UI embedded resources: a tool result may carry its own interactive view
 * as an embedded `ui://` resource content block, instead of (or as well as)
 * pointing its tool definition at one (MCP Apps `_meta.ui.resourceUri`).
 *
 * ```json
 * { "type": "resource",
 *   "resource": { "uri": "ui://demo/card", "mimeType": "text/html", "text": "<button>…" } }
 * ```
 *
 * Two forms render: `text/html` (the HTML document itself, in `text` or
 * base64 `blob`) and `text/uri-list` (an external page, the first URL of the
 * list). Others (such as `application/vnd.mcp-ui.remote-dom`) do not.
 *
 * Wire content is untrusted: these parsers keep only what they validate.
 */

export const MCP_UI_HTML_MIME_TYPES = ['text/html', 'text/html;profile=mcp-app'] as const;
export const MCP_UI_URL_MIME_TYPE = 'text/uri-list';

/** Largest embedded document that renders; a bigger one falls back to the plain result. */
export const MCP_UI_RESOURCE_MAX_LENGTH = 2_000_000;

export type McpUiEmbeddedResource =
  { html: string; kind: 'html'; uri: string } | { kind: 'url'; uri: string; url: string };

interface ResourceBlock {
  resource: { blob?: unknown; mimeType?: unknown; text?: unknown; uri?: unknown };
  type: 'resource';
}

const isUiResourceBlock = (block: unknown): block is ResourceBlock => {
  const value = block as { resource?: { uri?: unknown }; type?: unknown } | null | undefined;
  return (
    value?.type === 'resource' &&
    typeof value.resource?.uri === 'string' &&
    value.resource.uri.startsWith('ui://')
  );
};

const normalizeMimeType = (value: unknown) =>
  typeof value === 'string' ? value.toLowerCase().replaceAll(/\s+/g, '') : undefined;

const decodeBase64 = (value: string): string | undefined => {
  try {
    const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
};

const readBody = (resource: ResourceBlock['resource']): string | undefined => {
  if (typeof resource.text === 'string') return resource.text;
  if (typeof resource.blob === 'string') return decodeBase64(resource.blob);
  return undefined;
};

/** The first http(s) URL of a `text/uri-list` (RFC 2483: `#` lines are comments). */
export const firstUriListUrl = (list: string): string | undefined => {
  const line = list
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('#'));
  if (!line) return;
  try {
    const url = new URL(line);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/** The view an embedded resource block renders, or `undefined` when it renders none. */
export const parseMcpUiResource = (block: unknown): McpUiEmbeddedResource | undefined => {
  if (!isUiResourceBlock(block)) return;
  const { resource } = block;
  const uri = resource.uri as string;
  const mimeType = normalizeMimeType(resource.mimeType);
  const body = readBody(resource);
  if (!body || body.length > MCP_UI_RESOURCE_MAX_LENGTH) return;

  if (MCP_UI_HTML_MIME_TYPES.some((type) => type === mimeType))
    return { html: body, kind: 'html', uri };
  if (mimeType === MCP_UI_URL_MIME_TYPE) {
    const url = firstUriListUrl(body);
    return url ? { kind: 'url', uri, url } : undefined;
  }
  return undefined;
};

/** Every renderable view among a tool result's content blocks, in order. */
export const getMcpUiResources = (content: unknown): McpUiEmbeddedResource[] =>
  Array.isArray(content)
    ? content.flatMap((block) => {
        const resource = parseMcpUiResource(block);
        return resource ? [resource] : [];
      })
    : [];

/** Whether a tool result's content carries at least one renderable view. */
export const hasMcpUiResource = (content: unknown): boolean =>
  Array.isArray(content) && content.some((block) => !!parseMcpUiResource(block));

/**
 * What the model reads for an embedded `ui://` block: which view was shown,
 * never its HTML. The view is for the user; the server's text blocks are what
 * it tells the model.
 */
export const describeMcpUiResourceBlock = (block: unknown): string | undefined => {
  if (!isUiResourceBlock(block)) return;
  const { mimeType, uri } = block.resource;
  const type = typeof mimeType === 'string' ? ` mimeType="${mimeType.replaceAll('"', '')}"` : '';
  return `<resource type="ui" uri="${(uri as string).replaceAll('"', '')}"${type} />`;
};
