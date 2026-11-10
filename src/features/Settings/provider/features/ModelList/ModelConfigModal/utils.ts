import type { FormValues } from '@lobehub/ui/form';
import type { UpdateAiModelParams } from 'model-bank';

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
  { showDeployName }: { showDeployName?: boolean } = {},
): UpdateAiModelParams => {
  const abilities = (values.abilities ?? {}) as Record<string, unknown>;
  const settings = (values.settings ?? {}) as Record<string, unknown>;
  const config = (values.config ?? {}) as Record<string, unknown>;

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
    },
    type: values.type as UpdateAiModelParams['type'],
  };
};
