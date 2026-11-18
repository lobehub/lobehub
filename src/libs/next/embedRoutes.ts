/**
 * `/embed/agent/:slugOrId` and `/embed/agent/:slugOrId/:topicId` — the
 * conversation of a shared Agent, served to be framed by the origins its
 * creator allowed (`shareConfig.embedAllowedOrigins`).
 */
const AGENT_EMBED_ROUTE = /^\/embed\/agent\/([^/]+)(?:\/[^/]+)?\/?$/;

/** The share slug (or share id) of an embed page path, or `null` for any other path. */
export const matchAgentEmbedRoute = (pathname: string): string | null => {
  const match = AGENT_EMBED_ROUTE.exec(pathname.split(/[?#]/, 1)[0]!);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
};

export const AGENT_EMBED_NO_FRAME_DIRECTIVE = "frame-ancestors 'none'";

/**
 * Framing headers of an embed page response. The global `X-Frame-Options: DENY`
 * rule skips `/embed/*` (see `define-config.ts`), so this is the only framing
 * policy those responses carry. `X-Frame-Options` cannot express an allowlist,
 * so it is sent only when nothing may frame the page.
 */
export const withAgentEmbedFrameHeaders = <T extends Response>(
  response: T,
  directive: string,
): T => {
  response.headers.set('Content-Security-Policy', directive);
  if (directive === AGENT_EMBED_NO_FRAME_DIRECTIVE) response.headers.set('X-Frame-Options', 'DENY');
  else response.headers.delete('X-Frame-Options');
  // An embed page is a share page: reachable by link, never indexed.
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');

  return response;
};
