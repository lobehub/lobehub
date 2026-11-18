import { describeMcpUiResourceBlock } from '@lobechat/const/mcpApp';

/**
 * What the model reads of a server MCP call. A result with an MCP App view
 * gives its text only: MCP Apps keeps `structuredContent` and `_meta` for the
 * view, out of model context. Any other result (no view, an error, a failed
 * view lookup) keeps its serialized form, `structuredContent` included, but
 * never `_meta`: protocol metadata, where an Apps-aware server keeps what only
 * its views may see. Embedded MCP-UI views (`mcpUi`) are summarized, not sent
 * as HTML.
 */
export const toModelContent = (result: any): string => {
  if (result?.state?.mcpApp) return result.content;
  if (!result?.state || typeof result.state !== 'object') return JSON.stringify(result);

  const { _meta, mcpUi, ...state } = result.state;
  // MCP-UI keeps `structuredContent` for the model; only its views' HTML is the user's
  if (mcpUi && Array.isArray(state.content))
    state.content = state.content.map((block: unknown) => {
      const summary = describeMcpUiResourceBlock(block);
      return summary ? { text: summary, type: 'text' } : block;
    });
  return JSON.stringify({ ...result, state });
};
