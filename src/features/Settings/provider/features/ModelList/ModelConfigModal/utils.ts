import type { FormValues } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import type { AiModelReasoningEffortSettings, UpdateAiModelParams } from 'model-bank/aiModel';
import { AiModelSourceEnum } from 'model-bank/aiModel';

const EDITABLE_ABILITIES = [
  'functionCall',
  'vision',
  'reasoning',
  'search',
  'imageOutput',
  'video',
] as const;

/**
 * Pick only the fields rendered by the model config form.
 *
 * base-ui `form.getValues()` returns every initial value, not just the registered fields
 * like antd `getFieldsValue()` did. The initial values are the merged model list item, so
 * they carry columns such as `config: null` (rejected by `UpdateAiModelSchema`, leaving the
 * confirm button spinning forever) and builtin-only settings that must not be persisted.
 */
export const pickModelConfigFormValues = (
  values: FormValues,
  {
    cardReasoningEffort,
    showDeployName,
  }: {
    /**
     * The builtin card's own `settings.reasoningEffort`, without the user's row
     * override. Compare against it, not the merged value the form opened with:
     * an earlier saved override would otherwise read as unchanged and be wiped,
     * since saving replaces the whole `settings` object.
     */
    cardReasoningEffort?: AiModelReasoningEffortSettings;
    showDeployName?: boolean;
  } = {},
): UpdateAiModelParams => {
  const abilities = (values.abilities ?? {}) as Record<string, unknown>;
  const settings = (values.settings ?? {}) as Record<string, unknown>;
  const config = (values.config ?? {}) as Record<string, unknown>;
  const reasoningEffort = settings.reasoningEffort as AiModelReasoningEffortSettings | undefined;
  // A builtin model's spec comes from its card. Persisting it when it equals the card
  // would pin the row to today's card and hide later card updates (levels, researched
  // defaults); a spec that differs is the user's override and must be kept.
  const keepReasoningEffort =
    values.source !== AiModelSourceEnum.Builtin || !isEqual(reasoningEffort, cardReasoningEffort);

  return {
    abilities: Object.fromEntries(
      EDITABLE_ABILITIES.map((key) => [key, abilities[key] ?? undefined]),
    ) as UpdateAiModelParams['abilities'],
    config: showDeployName
      ? { deploymentName: (config.deploymentName as string | undefined) ?? undefined }
      : undefined,
    contextWindowTokens: values.contextWindowTokens as number | null | undefined,
    displayName: values.displayName as string | null | undefined,
    settings: {
      extendParams: (settings.extendParams ?? undefined) as NonNullable<
        UpdateAiModelParams['settings']
      >['extendParams'],
      reasoningEffort: keepReasoningEffort ? reasoningEffort : undefined,
    },
    type: values.type as UpdateAiModelParams['type'],
  };
};
