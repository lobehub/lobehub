import type { FieldSchema } from '@/server/services/bot/platforms/types';

interface ChannelConfigFormState {
  applicationId?: string;
  credentials?: Record<string, string>;
  settings?: Record<string, unknown> | null;
}

interface ChannelFormSettings {
  [key: string]: {} | undefined;
}

/**
 * Allowlist fields used to be stored as a comma-separated string and briefly
 * as a bare `string[]`, before evolving into `[{ id, name? }]`. Migrate any
 * pre-object-list payload up to the new shape on read so the array form
 * editor can mount without crashing on a string. Still safe to write back —
 * the runtime parser (`parseIdList`) keeps accepting all three shapes.
 */
const ALLOWLIST_KEYS = new Set([
  'allowFrom',
  'groupAllowFrom',
  // The bot-wake channel lists share the `[{ id }]` row shape (see `BOT_WAKE_SETTING_KEYS`).
  'botWakeAllowChannels',
  'botWakeDenyChannels',
]);

const migrateAllowList = (value: unknown): Array<{ id: string; name?: string }> => {
  if (typeof value === 'string') {
    return value
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => ({ id }));
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return { id: entry.trim() };
        // Discord channel IDs are snowflakes: a hand-written config may carry them as bare
        // numbers. `parseIdList` accepts that shape, so dropping them here would silently
        // turn an allowlist into "unrestricted" (or a denylist into "nothing blocked") on
        // the next save of an untouched form.
        if (typeof entry === 'number' && Number.isFinite(entry)) return { id: String(entry) };
        if (entry && typeof entry === 'object' && 'id' in entry) {
          const id = String((entry as { id?: unknown }).id ?? '').trim();
          const rawName = (entry as { name?: unknown }).name;
          const name = typeof rawName === 'string' ? rawName : undefined;
          return name ? { id, name } : { id };
        }
        return { id: '' };
      })
      .filter((entry) => entry.id);
  }
  return [];
};

const normalizeSettings = (settings?: Record<string, unknown> | null): ChannelFormSettings =>
  Object.fromEntries(
    Object.entries(settings || {}).map(([key, value]) => [
      key,
      ALLOWLIST_KEYS.has(key) ? migrateAllowList(value) : (value ?? undefined),
    ]),
  );

export const getChannelFormValues = (config: ChannelConfigFormState) => ({
  applicationId: config.applicationId || '',
  credentials: config.credentials || {},
  settings: normalizeSettings(config.settings),
});

/**
 * Build the credential blob a save submits.
 *
 * The form is seeded from the persisted provider, which keeps every credential
 * *key* but replaces the values with masks (see `withoutBotProviderSecrets`).
 * The server replaces the credential blob wholesale on update, so any key the
 * form does not carry would be deleted on the way back — carry every key the
 * form leaves unmentioned from the config the form was seeded with. An explicit
 * empty (a field the user cleared) still wins and drops the key, so clearing a
 * credential keeps its meaning.
 */
export const mergeCredentialsForSave = (
  configCredentials: Record<string, string> | null | undefined,
  formCredentials: Record<string, string> | null | undefined,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries({ ...configCredentials, ...formCredentials }).filter(
      ([, value]) => value !== undefined && value !== '',
    ),
  );

/**
 * Whether the form should adopt an incoming (revalidated) provider config.
 *
 * The provider list is replica-backed, so a revisit paints the persisted config
 * first and the live fetch replaces it in the background. Adopting that
 * background copy while the user is mid-edit would silently discard their
 * input, so a replacement of the *same* provider is ignored until the form is
 * clean again — after a save / discard, or when a different provider arrives.
 */
export const shouldAdoptIncomingConfig = (
  previous: { id?: string; platform?: string } | undefined,
  next: { id?: string; platform?: string } | undefined,
  isDirty: boolean,
): boolean => {
  const isSameProvider = previous?.id === next?.id && previous?.platform === next?.platform;
  return !(isSameProvider && isDirty);
};

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

const isBlankListEntry = (entry: unknown) => {
  if (typeof entry === 'string') return entry.trim() === '';
  if (entry && typeof entry === 'object' && 'id' in entry)
    return String((entry as { id?: unknown }).id ?? '').trim() === '';
  return false;
};

/** Rows the editor opened but left empty never reach the runtime; count only real entries. */
export const countListEntries = (value: unknown[]) =>
  value.filter((entry) => !isBlankListEntry(entry)).length;

/**
 * Settings list fields whose value pushes past the schema's `maximum`.
 *
 * The list editor stops adding rows at the cap, but a hand-written config — or a list saved before
 * the cap existed — can still arrive over it. The bot-wake parser rejects an over-cap list
 * wholesale (`idList.max(...).catch([])`), which for an allowlist silently means "restrict
 * nothing" while the form keeps showing every entry. The save path refuses such a value instead of
 * persisting one the runtime cannot honour.
 */
export const findOverLimitSettings = (
  schema: FieldSchema[] | undefined,
  settings: Record<string, unknown> | undefined,
): Array<{ count: number; key: string; max: number }> => {
  const fields = schema?.find((field) => field.key === 'settings')?.properties ?? [];
  // Settings groups render flat, so a list can sit either directly in `settings` or in a group.
  const listFields = fields.flatMap((field) =>
    field.type === 'object' && field.properties ? field.properties : [field],
  );

  return listFields.flatMap((field) => {
    if (field.type !== 'array' || typeof field.maximum !== 'number') return [];
    const value = settings?.[field.key];
    if (!Array.isArray(value)) return [];
    const count = countListEntries(value);
    return count > field.maximum ? [{ count, key: field.key, max: field.maximum }] : [];
  });
};

/**
 * Whether a field is released to the signed-in user. A field that names a `featureFlag` is shown
 * only when that flag is explicitly on; an unset flag, or flags that have not loaded yet, hide it.
 * Hiding is cosmetic: the server stays authoritative for what a setting does.
 */
export const isFieldReleased = (
  field: Pick<FieldSchema, 'featureFlag'>,
  featureFlags: Record<string, unknown> | undefined,
): boolean => !field.featureFlag || featureFlags?.[field.featureFlag] === true;

/**
 * The master switch of the bot-wake options. A switch whose effect is a plain on/off, so it saves
 * the moment it changes, like the reply display options.
 */
export const WAKE_MASTER_KEY = 'botWakeEnabled';

/**
 * Settings for a bot that is still being created: the wake switch starts on. A saved bot keeps
 * what it stored, and one saved before the switch existed reads as off, as the runtime does.
 */
export const withNewBotWakeOn = (
  schema: FieldSchema[] | undefined,
  settings: Record<string, unknown>,
): Record<string, unknown> => {
  const fields = schema?.find((field) => field.key === 'settings')?.properties ?? [];
  if (settings[WAKE_MASTER_KEY] !== undefined) return settings;
  if (!fields.some((field) => field.key === WAKE_MASTER_KEY)) return settings;

  return { ...settings, [WAKE_MASTER_KEY]: true };
};
