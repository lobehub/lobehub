/**
 * Route prefix of the agent-share visitor page. `/a/<slug>` on purpose — short
 * enough to read aloud, and not `/agent/…`, which the marketing site already
 * uses for the public agent market, so a shared link can never be mistaken
 * for (or proxied to) a market listing.
 */
export const AGENT_SHARE_VISITOR_PATH = '/a';

/** Visitor page of an agent share, by custom slug or raw share id. */
export const buildAgentShareVisitorPath = (slugOrId: string) =>
  `${AGENT_SHARE_VISITOR_PATH}/${slugOrId}`;

/**
 * Sign-in URL that returns the visitor to the same share once signed in.
 * `/signin` is an auth shell outside the SPA router, so callers navigate to it
 * with a full document load.
 */
export const buildAgentShareSignInUrl = (slugOrId: string) =>
  `/signin?callbackUrl=${encodeURIComponent(buildAgentShareVisitorPath(slugOrId))}`;

/**
 * Where the CREATOR lands when they open their own share link: the share
 * settings page, or the agent itself on a platform without that page
 * (mobile). The creator is never a visitor of their own share.
 */
export const buildAgentShareOwnerPath = (agentId: string, { mobile = false } = {}) =>
  mobile ? `/agent/${agentId}` : `/agent/${agentId}/share`;
