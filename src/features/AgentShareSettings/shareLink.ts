import { AGENT_SHARE_SLUG_PATTERN, RESERVED_AGENT_SHARE_SLUGS } from '@lobechat/const';

/**
 * Client mirror of `AgentShareModel.updateSlug`'s UUID rejection: a
 * UUID-shaped slug would be unreachable because `findBySlugOrId` resolves
 * UUID-shaped input as a share id before ever trying the slug lookup.
 */
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export type AgentShareSlugError = 'invalid' | 'reserved' | 'tooLong' | 'tooShort';

/** Slugs are stored lowercase; normalize before validating so the check matches the server's. */
export const normalizeAgentShareSlug = (input: string): string => input.trim().toLowerCase();

/**
 * Client-side mirror of the server's slug rules (`AGENT_SHARE_SLUG_PATTERN` +
 * `RESERVED_AGENT_SHARE_SLUGS` + the UUID guard). The server remains the real
 * gate — this only turns an obviously-invalid slug into inline feedback
 * instead of a round trip. Uniqueness cannot be checked here; a taken slug
 * still comes back as `CONFLICT`.
 *
 * Returns `null` when the normalized slug is acceptable.
 */
export const validateAgentShareSlug = (slug: string): AgentShareSlugError | null => {
  if (slug.length < 3) return 'tooShort';
  if (slug.length > 64) return 'tooLong';
  if (!AGENT_SHARE_SLUG_PATTERN.test(slug) || UUID_PATTERN.test(slug)) return 'invalid';
  if (RESERVED_AGENT_SHARE_SLUGS.includes(slug)) return 'reserved';

  return null;
};

/**
 * Visitor URL for a share. The custom slug is preferred when set, but the raw
 * share id always resolves too — so a link handed out before a slug was chosen
 * keeps working.
 */
export const buildAgentShareUrl = ({
  origin,
  shareId,
  slug,
}: {
  origin: string;
  shareId: string;
  slug?: string;
}): string => `${origin}/agent/${slug || shareId}`;
