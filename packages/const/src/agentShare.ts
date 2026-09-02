import { PLUGIN_SCHEMA_SEPARATOR } from './plugin';

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

/**
 * One parsed `shareConfig.enabledToolIds` entry.
 *
 * An entry is either a bare toolset identifier (`lobe-agent`), which grants
 * every (non-blocked) API of that tool, or a per-API scoped entry
 * (`lobe-agent____analyzeMedia`, joined with {@link PLUGIN_SCHEMA_SEPARATOR}),
 * which grants only the named API. `apiName` is absent for the toolset-level
 * form.
 */
export interface ShareToolEntry {
  apiName?: string;
  identifier: string;
}

/**
 * Parse one raw `enabledToolIds` entry into its identifier and optional
 * per-API scope. Returns `undefined` for a malformed entry — more than one
 * separator, or an empty identifier/apiName segment — so callers can drop it
 * instead of silently misinterpreting the raw string (used by both the router
 * zod validator, which rejects malformed input outright, and the runtime
 * gates, which fail closed by ignoring it).
 *
 * Single source of truth for this encoding, shared by the server gates
 * (`apps/server/src/services/aiAgent/shareGate.ts`) and the client share
 * settings UI (`src/features/AgentShareSettings`), so both sides agree on what
 * a stored entry means.
 */
export const parseShareToolEntry = (entry: string): ShareToolEntry | undefined => {
  const parts = entry.split(PLUGIN_SCHEMA_SEPARATOR);

  if (parts.length === 1) {
    const [identifier] = parts;
    return identifier ? { identifier } : undefined;
  }

  if (parts.length !== 2) return undefined;

  const [identifier, apiName] = parts;
  return identifier && apiName ? { apiName, identifier } : undefined;
};

/** Inverse of {@link parseShareToolEntry}: build a raw `enabledToolIds` entry. */
export const buildShareToolEntry = (identifier: string, apiName?: string): string =>
  apiName ? `${identifier}${PLUGIN_SCHEMA_SEPARATOR}${apiName}` : identifier;

/**
 * One identifier's resolved grant: `'all'` for a toolset-level entry, or the
 * specific `Set` of API names a per-API entry named.
 */
export type ShareToolGrant = 'all' | Set<string>;

/**
 * Reduce raw `enabledToolIds` entries into one grant per identifier.
 *
 * A toolset-level entry always wins over per-API entries for the same
 * identifier, regardless of array order — once an identifier resolves to
 * `'all'` it can never be narrowed back down by a later per-API entry, matching
 * the "toolset-level entry wins" rule every gate enforces.
 */
export const resolveShareToolGrants = (
  entries: string[] | undefined,
): Map<string, ShareToolGrant> => {
  const grants = new Map<string, ShareToolGrant>();

  for (const raw of entries ?? []) {
    const parsed = parseShareToolEntry(raw);
    if (!parsed) continue;

    const { identifier, apiName } = parsed;
    if (grants.get(identifier) === 'all') continue;

    if (!apiName) {
      grants.set(identifier, 'all');
      continue;
    }

    const existing = grants.get(identifier);
    const apiNames = existing instanceof Set ? existing : new Set<string>();
    apiNames.add(apiName);
    grants.set(identifier, apiNames);
  }

  return grants;
};

/** Whether `identifier` has any grant (toolset-level or per-API) in `grants`. */
export const hasShareToolGrant = (
  grants: Map<string, ShareToolGrant>,
  identifier: string,
): boolean => grants.has(identifier);

/** Whether `identifier`'s specific `apiName` is granted — toolset-level grants every API. */
export const isShareToolApiGranted = (
  grants: Map<string, ShareToolGrant>,
  identifier: string,
  apiName: string,
): boolean => {
  const grant = grants.get(identifier);
  if (!grant) return false;
  return grant === 'all' || grant.has(apiName);
};
