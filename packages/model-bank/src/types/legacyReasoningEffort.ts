import { LEGACY_CARD_EFFORT_KEYS } from './legacyCardEffortKeys';
import { createReasoningEffortSettings, type ReasoningEffortLevel } from './reasoningEffort';

/**
 * The per-model effort keys that existed before `settings.reasoningEffort`,
 * with the levels each one offered. Each was both an `extendParams` entry on a
 * model card and the saved-config key holding the pick; every value is a
 * `ReasoningEffortLevel`, so a pick moves to `reasoningEffort` unchanged.
 * `reasoningEffort` itself is listed because the generic extend param shared
 * the new field's name.
 */
export const LEGACY_EFFORT_LEVELS: Record<string, ReasoningEffortLevel[]> = {
  codexMaxReasoningEffort: ['low', 'medium', 'high', 'xhigh'],
  deepseekV4GAReasoningEffort: ['none', 'low', 'high', 'max'],
  deepseekV4ReasoningEffort: ['none', 'high', 'max'],
  effort: ['low', 'medium', 'high', 'max'],
  glm5_2ReasoningEffort: ['high', 'max'],
  glm5_3ReasoningEffort: ['low', 'high', 'max'],
  gpt5_1ReasoningEffort: ['none', 'low', 'medium', 'high'],
  gpt5_2ProReasoningEffort: ['medium', 'high', 'xhigh'],
  gpt5_2ReasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh'],
  gpt5_6ReasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  gpt5ReasoningEffort: ['minimal', 'low', 'medium', 'high'],
  gpt6ReasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max'],
  grok4_3ReasoningEffort: ['none', 'low', 'medium', 'high'],
  grok4_5ReasoningEffort: ['low', 'medium', 'high'],
  grok4_6ReasoningEffort: ['low', 'medium', 'high', 'xhigh'],
  grok4_7ReasoningEffort: ['low', 'medium', 'high', 'xhigh'],
  grok4_20ReasoningEffort: ['low', 'medium', 'high', 'xhigh'],
  hy3ReasoningEffort: ['no_think', 'low', 'high'],
  kimiK3ReasoningEffort: ['low', 'high', 'max'],
  opus47Effort: ['low', 'medium', 'high', 'xhigh', 'max'],
  qwen38ReasoningEffort: ['none', 'low', 'medium', 'xhigh'],
  reasoningEffort: ['low', 'medium', 'high'],
  ring2_6ReasoningEffort: ['high', 'xhigh'],
  step3_5ReasoningEffort: ['low', 'high'],
  thinkingLevel: ['minimal', 'low', 'medium', 'high'],
  thinkingLevel2: ['low', 'high'],
  thinkingLevel3: ['low', 'medium', 'high'],
  thinkingLevel4: ['minimal', 'high'],
};

/** Legacy keys whose effort also switched thinking on or off. */
const LEGACY_CONTROLS_THINKING = new Set([
  'deepseekV4GAReasoningEffort',
  'deepseekV4ReasoningEffort',
  'glm5_3ReasoningEffort',
  'qwen38ReasoningEffort',
]);

/** Legacy effort entries of `settings.extendParams`. */
export const LEGACY_EXTEND_PARAMS = Object.keys(LEGACY_EFFORT_LEVELS);

/**
 * Saved-value keys of the per-model effort params that `reasoningEffort`
 * replaced. Writes that set `reasoningEffort` remove them, so a leftover key is
 * always a pick made by the previous app version and the migration script can
 * still move it without overwriting a newer pick.
 */
export const LEGACY_REASONING_EFFORT_KEYS = LEGACY_EXTEND_PARAMS.filter(
  (key) => key !== 'reasoningEffort',
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

let legacyEffortKeyById: Map<string, string | null> | undefined;

/** Bare model id → legacy key, kept only when every provider's card agreed. */
const getLegacyEffortKeyById = () => {
  if (legacyEffortKeyById) return legacyEffortKeyById;
  const keys = new Map<string, string | null>();
  for (const [cardKey, effortKey] of Object.entries(LEGACY_CARD_EFFORT_KEYS)) {
    const id = cardKey.slice(cardKey.lastIndexOf('/') + 1);
    const known = keys.get(id);
    keys.set(id, known === undefined || known === effortKey ? effortKey : null);
  }
  legacyEffortKeyById = keys;
  return keys;
};

export interface LegacyEffortKeyContext {
  /** The row's own `settings.extendParams` (custom and remote models). */
  extendParams?: unknown;
  model?: string | null;
  provider?: string | null;
}

/**
 * The effort key the old runtime read for a model: the row's own extend param,
 * else the key its pre-migration card declared (by `provider/model`, then by
 * bare id when unambiguous). `undefined` when unknown.
 */
export const resolveLegacyEffortKey = ({
  extendParams,
  model,
  provider,
}: LegacyEffortKeyContext): string | undefined => {
  if (Array.isArray(extendParams)) {
    const own = extendParams.find(
      (param): param is string => typeof param === 'string' && param in LEGACY_EFFORT_LEVELS,
    );
    if (own) return own;
  }
  if (!model) return;

  return (
    (provider ? LEGACY_CARD_EFFORT_KEYS[`${provider}/${model}`] : undefined) ??
    getLegacyEffortKeyById().get(model.slice(model.lastIndexOf('/') + 1)) ??
    undefined
  );
};

/**
 * Removes the legacy effort keys from a saved config when a write sets
 * `reasoningEffort`, so the new pick is the only effort value left.
 */
export const stripLegacyEffortKeys = <T extends Record<string, unknown>>(config: T): T => {
  if (config.reasoningEffort === undefined) return config;
  const next: Record<string, unknown> = { ...config };
  for (const key of LEGACY_REASONING_EFFORT_KEYS) delete next[key];
  return next as T;
};

export type MigrateReasoningConfigResult =
  | {
      /**
       * The model's legacy key is unknown and the saved values (legacy and
       * generic) disagree, so the row is left as is for manual review.
       */
      conflict: true;
      next?: undefined;
    }
  | { conflict: false; next: Record<string, unknown> };

/**
 * Collapses a saved reasoning config (model-instance `config.chatConfig`, topic
 * `metadata.reasoningConfig`, sub-agent `chatConfig`) into the single
 * `reasoningEffort` field. Returns `undefined` when there is nothing to change.
 *
 * The value of `effortKey` — the key the old runtime actually read for this
 * model — wins, even over an existing `reasoningEffort`: before this migration a
 * GPT-5.2 row could hold a stale generic `reasoningEffort` next to the
 * `gpt5_2ReasoningEffort` it really ran at. New-version writes strip the legacy
 * keys (`stripLegacyEffortKeys`), so a legacy key still present always comes
 * from the old version. Without a known key, the values are kept only when they
 * all agree.
 */
export const migrateReasoningConfig = (
  config: unknown,
  effortKey?: string,
): MigrateReasoningConfigResult | undefined => {
  if (!isRecord(config)) return;

  const present = LEGACY_REASONING_EFFORT_KEYS.filter((key) => config[key] !== undefined);
  if (present.length === 0) return;

  const next = { ...config };
  for (const key of present) delete next[key];

  const isOffered = (key: string) =>
    LEGACY_EFFORT_LEVELS[key].includes(config[key] as ReasoningEffortLevel);

  if (effortKey && effortKey in LEGACY_EFFORT_LEVELS && config[effortKey] !== undefined) {
    if (isOffered(effortKey)) next.reasoningEffort = config[effortKey];
    else if (effortKey !== 'reasoningEffort') delete next.reasoningEffort;
    return { conflict: false, next };
  }

  const values = new Set(present.filter(isOffered).map((key) => config[key]));
  if (next.reasoningEffort !== undefined) values.add(next.reasoningEffort);
  if (values.size > 1) return { conflict: true };

  const [value] = values;
  if (value !== undefined) next.reasoningEffort = value;
  return { conflict: false, next };
};

/**
 * Translates a reasoning config written by a released client that still sends
 * legacy keys (e.g. `{ gpt5_6ReasoningEffort: 'max' }` → `{ reasoningEffort:
 * 'max' }`), so its pick is kept. The key the old runtime read for the model
 * (`model` / `provider`, as in `resolveLegacyEffortKey`) wins; without one, a
 * single legacy key wins, since a client writes the key its runtime read.
 * Disagreeing values that cannot be told apart are dropped, keeping the
 * generic value. Configs without legacy keys are returned unchanged.
 */
export const translateLegacyReasoningConfig = <T extends object>(
  input: T,
  context: LegacyEffortKeyContext = {},
): T => {
  const config = input as Record<string, unknown>;
  const present = LEGACY_REASONING_EFFORT_KEYS.filter((key) => config[key] !== undefined);
  if (present.length === 0) return input;

  const modelKey = resolveLegacyEffortKey(context);
  const effortKey =
    modelKey && config[modelKey] !== undefined
      ? modelKey
      : present.length === 1
        ? present[0]
        : undefined;
  const result = migrateReasoningConfig(config, effortKey);
  if (result && !result.conflict) return result.next as T;

  const next: Record<string, unknown> = { ...config };
  for (const key of present) delete next[key];
  return next as T;
};

export interface MigrateModelSettingsContext {
  /**
   * The provider ships a card for this model, so the card's spec applies and
   * the row only drops its legacy keys.
   */
  hasProviderCard: boolean;
}

/**
 * Moves a model's legacy effort extend param into `settings.reasoningEffort`.
 * Models backed by a provider card only drop the key; custom and remote-only
 * models get the legacy key's levels — the ones their API accepted, which a
 * same-id card elsewhere may not match — without a default, so it still
 * resolves from the same model at runtime. Returns `undefined` when there is
 * nothing to change.
 */
export const migrateModelSettings = (
  settings: unknown,
  { hasProviderCard }: MigrateModelSettingsContext,
): Record<string, unknown> | undefined => {
  if (!isRecord(settings) || !Array.isArray(settings.extendParams)) return;

  const extendParams = settings.extendParams as unknown[];
  const legacy = extendParams.filter(
    (param): param is string => typeof param === 'string' && param in LEGACY_EFFORT_LEVELS,
  );
  if (legacy.length === 0) return;

  const next: Record<string, unknown> = { ...settings };
  const rest = extendParams.filter((param) => !legacy.includes(param as string));
  if (rest.length > 0) next.extendParams = rest;
  else delete next.extendParams;

  if (!hasProviderCard && next.reasoningEffort === undefined) {
    const [key] = legacy;
    next.reasoningEffort = createReasoningEffortSettings(LEGACY_EFFORT_LEVELS[key], {
      controlsThinking: LEGACY_CONTROLS_THINKING.has(key),
    });
  }

  return next;
};
