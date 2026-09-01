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
 * case-insensitive-safe. UUID-shaped slugs are additionally rejected in
 * `AgentShareModel.updateSlug` — `findBySlugOrId` resolves UUID-shaped input
 * as a share id first, so such a slug would be unreachable.
 */
export const AGENT_SHARE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/**
 * Slugs a share may not claim. Two groups:
 *
 * 1. words that collide with existing (or foreseeable) static routes under the
 *    agent surface (e.g. `/agent/<slug>`, `/agent/new`), or that would
 *    otherwise confuse a share URL;
 * 2. every builtin agent slug — a share lives at `/agent/<slug>`, the same
 *    route the creator's own agents use, and an own agent always wins the
 *    lookup, so a share taking a builtin slug would be permanently unreachable.
 *
 * The builtin slugs are duplicated here rather than imported: `@lobechat/const`
 * sits *below* `@lobechat/builtin-agents` in the dependency graph. The copy is
 * kept honest by a test that diffs it against `BUILTIN_AGENT_SLUGS`.
 *
 * Checked by `AgentShareModel.updateSlug` before a custom slug is written.
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
  // Builtin agent slugs — mirror of `BUILTIN_AGENT_SLUGS`.
  'agent-builder',
  'group-agent-builder',
  'group-supervisor',
  'inbox',
  'nightly-review',
  'onboarding-understanding',
  'onboarding-task-recommender',
  'page-agent',
  'self-feedback-intent',
  'self-reflection',
  'skill-management',
  'task-agent',
  'verify-agent',
  'web-onboarding',
];
