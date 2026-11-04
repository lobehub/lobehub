import type { CallToolResult } from '@modelcontextprotocol/client';

// MCP image and audio `data` is base64; anything else is a reference, not media
const BASE64 = /^[\d+/a-z]+={0,2}$/i;

/**
 * The tool result as the view gets it. The chat stores a result's image and
 * audio as uploaded URLs or desktop files, which are not the base64 `data` MCP
 * defines, so those blocks are left out rather than handed over broken. They
 * are never dereferenced: a reference in a result may come from the MCP server
 * itself and point anywhere, and the host would read it with the user's
 * cookies or file access. A view that needs the media calls the tool, which
 * returns it raw.
 */
export const withoutStoredMedia = (result: CallToolResult): CallToolResult => ({
  ...result,
  content: result.content.filter(
    (block) => (block.type !== 'image' && block.type !== 'audio') || BASE64.test(block.data),
  ),
});
