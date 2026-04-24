import type { FieldSchema } from '@/server/services/bot/platforms/types';

interface ChannelConfigFormState {
  applicationId?: string;
  credentials?: Record<string, string>;
  settings?: Record<string, unknown> | null;
}

interface ChannelFormSettings {
  [key: string]: {} | undefined;
}

const normalizeSettings = (settings?: Record<string, unknown> | null): ChannelFormSettings =>
  Object.fromEntries(
    Object.entries(settings || {}).map(([key, value]) => [key, value ?? undefined]),
  );

export const getChannelFormValues = (config: ChannelConfigFormState) => ({
  applicationId: config.applicationId || '',
  credentials: config.credentials || {},
  settings: normalizeSettings(config.settings),
});

/**
 * Extract default values from a platform's settings schema, in the same flat
 * shape used by the form (top-level keys + flattened nested object children,
 * matching `getFields` in Body.tsx).
 *
 * Needed because antd `<FormItem initialValue>` only writes to the form store
 * after the FormItem mounts. Settings live behind a collapsible "Advanced
 * Settings" panel that defaults to collapsed — so users who never expand it
 * submit `settings: {}`, dropping every default and leaving the runtime to
 * guess at fields like `connectionMode`.
 */
export const extractSettingsDefaults = (
  schema: FieldSchema[] | undefined,
): Record<string, unknown> => {
  const settingsSection = schema?.find((f) => f.key === 'settings');
  if (!settingsSection?.properties) return {};

  const defaults: Record<string, unknown> = {};
  for (const field of settingsSection.properties) {
    if (field.type === 'object' && field.properties) {
      for (const child of field.properties) {
        if (child.default !== undefined) defaults[child.key] = child.default;
      }
      continue;
    }
    if (field.default !== undefined) defaults[field.key] = field.default;
  }
  return defaults;
};

/**
 * Merge schema defaults into the user-submitted settings object. User-provided
 * values always win over defaults.
 */
export const mergeSettingsWithDefaults = (
  schema: FieldSchema[] | undefined,
  settings: Record<string, unknown>,
): Record<string, unknown> => ({
  ...extractSettingsDefaults(schema),
  ...settings,
});
