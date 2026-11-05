import {
  LEGACY_EXTEND_PARAMS,
  LEGACY_REASONING_EFFORT_KEYS,
  migrateModelSettings,
  migrateReasoningConfig,
  resolveLegacyEffortKey,
} from 'model-bank/aiModel';

export {
  LEGACY_EXTEND_PARAMS,
  migrateModelSettings,
  migrateReasoningConfig,
  resolveLegacyEffortKey,
};

/** Saved-value keys that moved to `reasoningEffort` (which keeps its own name). */
export const LEGACY_CONFIG_KEYS: readonly string[] = LEGACY_REASONING_EFFORT_KEYS;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export interface MigrateAiModelRowInput {
  /** The provider card declares this model's effort spec (see `migrateModelSettings`). */
  cardDeclaresEffort: boolean;
  chatConfig: unknown;
  model: string;
  provider: string;
  settings: unknown;
}

export type MigrateAiModelRowResult =
  | { conflict: true }
  | {
      chatConfig?: Record<string, unknown>;
      conflict: false;
      settings?: Record<string, unknown>;
    };

/**
 * Migrates one `ai_models` row: its saved pick and its own effort declaration.
 * A conflicting pick leaves the whole row unchanged for manual review, since a
 * new settings spec would make the runtime read the unresolved values.
 */
export const migrateAiModelRow = ({
  chatConfig,
  cardDeclaresEffort,
  model,
  provider,
  settings,
}: MigrateAiModelRowInput): MigrateAiModelRowResult | undefined => {
  const effortKey = resolveLegacyEffortKey({
    extendParams: isRecord(settings) ? settings.extendParams : undefined,
    model,
    provider,
  });
  const nextChatConfig = migrateReasoningConfig(chatConfig, effortKey);
  if (nextChatConfig?.conflict) return { conflict: true };

  const nextSettings = migrateModelSettings(settings, { cardDeclaresEffort });
  if (!nextChatConfig && !nextSettings) return;
  return { chatConfig: nextChatConfig?.next, conflict: false, settings: nextSettings };
};
