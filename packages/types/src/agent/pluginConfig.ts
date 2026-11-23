import { z } from 'zod';

import { resolveToolMode } from './executionTargetRules';

/**
 * Three-state per-agent plugin config.
 *
 * `agents.plugins` (JSONB) stays `AgentPluginEntry[]` at the DB layer — no
 * schema migration. Legacy rows only ever contain bare identifier strings;
 * new writes upgrade a touched entry to `AgentPluginConfigItem` in place and
 * leave every other, untouched entry in its original shape (lazy per-item
 * upgrade — mixed-shape arrays are a permanent, not transitional, state).
 */
export type AgentPluginMode = 'pinned' | 'auto' | 'disabled';

export interface AgentPluginConfigItem {
  /** An explicit agent choice made after library-wide builtin uninstalls were retired. */
  builtinOverride?: true;
  identifier: string;
  /**
   * @default 'pinned' — absent on legacy string entries and on object
   * entries written before this field existed.
   */
  mode?: AgentPluginMode;
}

export type AgentPluginEntry = string | AgentPluginConfigItem;

export const AgentPluginModeSchema = z.enum(['pinned', 'auto', 'disabled']);

/**
 * Zod schema for a single `plugins[]` entry — for input validation on
 * routers/procedures that accept a caller-supplied plugins array (e.g. group
 * member creation). Accepts both the legacy bare string and the tri-state
 * object shape, so a client can pre-seed a disabled/pinned entry instead of
 * being rejected by a `z.array(z.string())` schema.
 */
export const AgentPluginEntrySchema: z.ZodType<AgentPluginEntry> = z.union([
  z.string(),
  z.object({
    builtinOverride: z.literal(true).optional(),
    identifier: z.string(),
    mode: AgentPluginModeSchema.optional(),
  }),
]);

/**
 * Normalizes a single entry: legacy strings and mode-less objects both
 * resolve to `'pinned'`, matching the pre-existing "present in the array ==
 * pinned" behavior.
 */
export const parsePluginEntry = (
  entry: AgentPluginEntry,
): { identifier: string; mode: AgentPluginMode } =>
  typeof entry === 'string'
    ? { identifier: entry, mode: 'pinned' }
    : { identifier: entry.identifier, mode: entry.mode ?? 'pinned' };

/**
 * Resolves an identifier's mode. An identifier absent from `plugins`
 * altogether is `'auto'` — the implicit default for anything in the user's
 * installed/connected pool that the agent hasn't explicitly pinned or
 * disabled.
 */
export const getPluginMode = (
  plugins: AgentPluginEntry[] | undefined,
  identifier: string,
): AgentPluginMode => {
  const entry = plugins?.find((item) => parsePluginEntry(item).identifier === identifier);
  return entry ? parsePluginEntry(entry).mode : 'auto';
};

/** Profile-managed skills are off without an entry and loaded on demand when on. */
export const LIBRARY_SKILL_IMPLICIT_MODE = 'disabled' as const;

export const getLibrarySkillMode = (
  plugins: AgentPluginEntry[] | undefined,
  identifier: string,
): 'auto' | 'disabled' => {
  const entry = plugins?.find((item) => parsePluginEntry(item).identifier === identifier);
  return entry && parsePluginEntry(entry).mode !== 'disabled' ? 'auto' : 'disabled';
};

/**
 * Connectors — the user's MCP connectors, Composio and LobeHub connections and
 * installed plugins — are discoverable by default in agent mode. Custom
 * toolsets only include their explicitly configured connectors.
 */
export const CONNECTOR_IMPLICIT_MODE = 'auto' as const;

/** The mode the two-state connector switch writes for "on". */
export const CONNECTOR_ON_MODE: AgentPluginMode = 'auto';

/**
 * A connector's state for this agent: `'auto'` (on — the model finds it on
 * demand) or `'disabled'` (off). A `'pinned'` entry written before connectors
 * lost that state reads as on, so no stored row needs rewriting.
 */
export const getConnectorMode = (
  plugins: AgentPluginEntry[] | undefined,
  identifier: string,
  chatConfig?: Parameters<typeof resolveToolMode>[0],
): 'auto' | 'disabled' => {
  const entry = plugins?.find((item) => parsePluginEntry(item).identifier === identifier);
  if (!entry) return resolveToolMode(chatConfig) === 'agent' ? CONNECTOR_IMPLICIT_MODE : 'disabled';
  return parsePluginEntry(entry).mode === 'disabled' ? 'disabled' : 'auto';
};

/** A connection initiated from an exact toolset needs an entry unless the agent already chose a mode. */
export const shouldEnableConnectorOnConnect = (
  plugins: AgentPluginEntry[] | undefined,
  identifier: string,
  chatConfig?: Parameters<typeof resolveToolMode>[0],
): boolean =>
  resolveToolMode(chatConfig) !== 'agent' &&
  !plugins?.some((entry) => parsePluginEntry(entry).identifier === identifier);

const getPluginIdsByMode = (
  plugins: AgentPluginEntry[] | undefined,
  mode: AgentPluginMode,
): string[] =>
  (plugins ?? [])
    .map((item) => parsePluginEntry(item))
    .filter((item) => item.mode === mode)
    .map((item) => item.identifier);

export const getPinnedPluginIds = (plugins: AgentPluginEntry[] | undefined): string[] =>
  getPluginIdsByMode(plugins, 'pinned');

/** Identifiers explicitly configured for on-demand activation. */
export const getAutoPluginIds = (plugins: AgentPluginEntry[] | undefined): string[] =>
  getPluginIdsByMode(plugins, 'auto');

export const getDisabledPluginIds = (plugins: AgentPluginEntry[] | undefined): string[] =>
  getPluginIdsByMode(plugins, 'disabled');

/**
 * Every identifier the agent turned on, pinned or `auto`. This is the opt-in
 * list for library skills and explicitly configured toolsets.
 */
export const getOptedInPluginIds = (plugins: AgentPluginEntry[] | undefined): string[] =>
  (plugins ?? [])
    .map((item) => parsePluginEntry(item))
    .filter((item) => item.mode !== 'disabled')
    .map((item) => item.identifier);

/**
 * Pinned identifiers — the drop-in replacement for runtime boundaries that
 * used to read `agentConfig?.plugins ?? []` directly as the enabled-tool
 * list. Kept as a distinct name from `getPinnedPluginIds` so call sites read
 * as "what should actually run" rather than "what's pinned".
 */
export const getActivePluginIds = (plugins: AgentPluginEntry[] | undefined): string[] =>
  getPinnedPluginIds(plugins);

/**
 * Sets `identifier`'s mode, upgrading only that one entry. Every other entry
 * — including untouched legacy strings — is returned unchanged.
 *
 * `implicitMode` is what an identifier absent from `plugins` resolves to —
 * `'auto'` for everything but a library skill
 * ({@link LIBRARY_SKILL_IMPLICIT_MODE}). Setting that mode removes any existing
 * entry instead of persisting a redundant record, which mirrors the
 * pre-tri-state behavior where unpinning spliced the id out of the array. Every
 * other mode is written explicitly, so a library skill set to `'auto'` keeps a
 * `{ identifier, mode: 'auto' }` entry.
 */
export const upsertPluginMode = (
  plugins: AgentPluginEntry[] | undefined,
  identifier: string,
  mode: AgentPluginMode,
  implicitMode: AgentPluginMode = 'auto',
): AgentPluginEntry[] => {
  const list = plugins ? [...plugins] : [];
  const index = list.findIndex((item) => parsePluginEntry(item).identifier === identifier);

  if (mode === implicitMode) {
    if (index !== -1) list.splice(index, 1);
    return list;
  }

  if (index === -1) {
    list.push({ identifier, mode });
    return list;
  }

  const existing = list[index];
  list[index] =
    typeof existing === 'string' ? { identifier: existing, mode } : { ...existing, mode };

  return list;
};

/**
 * Writes the two-state connector switch. On is an explicit `auto` entry —
 * including for custom toolsets. Off keeps a `disabled` entry rather than
 * dropping it, so the connector stays listed on the agent and can be turned
 * back on; removing it from the agent is `upsertPluginMode(…, 'auto')`.
 */
export const upsertConnectorEnabled = (
  plugins: AgentPluginEntry[] | undefined,
  identifier: string,
  enabled: boolean,
): AgentPluginEntry[] =>
  enabled
    ? upsertPluginMode(plugins, identifier, CONNECTOR_ON_MODE, 'disabled')
    : upsertPluginMode(plugins, identifier, 'disabled');

export const getBuiltinOverrides = (plugins?: AgentPluginEntry[] | null): string[] =>
  (plugins ?? []).flatMap((entry) =>
    typeof entry !== 'string' && entry.builtinOverride ? [entry.identifier] : [],
  );

export const setBuiltinPluginMode = (
  plugins: AgentPluginEntry[] | undefined,
  identifier: string,
  mode: AgentPluginMode,
): AgentPluginEntry[] => {
  const choice = {
    builtinOverride: true,
    identifier,
    mode,
  } as const;
  const entries = plugins ?? [];
  const index = entries.findIndex((entry) => parsePluginEntry(entry).identifier === identifier);
  return index === -1
    ? [...entries, choice]
    : entries.map((entry, i) => (i === index ? choice : entry));
};
