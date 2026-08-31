/**
 * Default `AgentShareConfig.maxTopicsPerVisitor` applied when a share is
 * first created and whenever a legacy/partial config is normalized. Kept
 * conservative — the creator can raise it explicitly via `updateShareConfig`.
 */
export const AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR = 5;

/**
 * Default `AgentShareConfig.maxTurnsPerTopic` applied when a share is first
 * created and whenever a legacy/partial config is normalized.
 */
export const AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC = 20;

/**
 * Upper bound on a visitor-submitted `prompt` for an agent-share visitor run.
 *
 * Unlike the creator's own account (where oversized input is self-inflicted),
 * a share visitor run executes as the CREATOR: the text is persisted verbatim
 * into creator-owned messages. Without a size bound, any authenticated
 * visitor with a live link could submit HTTP-infrastructure-limit-sized
 * prompts on repeat, bloating the creator's message rows.
 *
 * 20,000 characters (~5-8k tokens for typical English/code text) comfortably
 * covers legitimate long-form asks (pasted code, long questions) while
 * keeping a single turn's contribution to storage/transport negligible.
 *
 * Kept in `@lobechat/const` (instead of inline in a router) so both the
 * server input schema and any client-side `maxLength`/error copy share one
 * source of truth — the server bound is still the real gate; a client mirror
 * is convenience only.
 */
export const SHARE_VISITOR_PROMPT_MAX_LENGTH = 20_000;

/**
 * Validates `AgentShareConfig.slug`: lowercase alphanumerics and hyphens
 * only, 3-64 characters, no leading/trailing hyphen. Deliberately excludes
 * uppercase and underscores to keep share URLs visually unambiguous and
 * case-insensitive-safe.
 */
export const AGENT_SHARE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;

/**
 * Slugs that collide with existing (or foreseeable) static routes under the
 * agent-share surface (e.g. `/share/agent/<slug>`, `/share/agent/new`), or
 * are otherwise reserved words that would confuse a share URL. Checked by
 * `AgentShareModel.updateSlug` before a custom slug is written.
 */
export const RESERVED_AGENT_SHARE_SLUGS: string[] = [
  'admin',
  'api',
  'edit',
  'index',
  'new',
  'profile',
  'settings',
  'share',
];
