import isEqual from 'fast-deep-equal';

import type { ChannelValues } from './channelTabs';

/**
 * Reply style is the one tab whose settings take effect as soon as they are
 * changed, so the page has to tell "reply settings that differ from what is
 * stored" (save them now) apart from "everything else that differs" (wait for
 * the Save button).
 */

type Settings = Record<string, unknown> | undefined;

/** A value as it would be stored: no `undefined`, no empty strings inside rows. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined && entry !== '')
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
};

export const pickKeys = (settings: Settings, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(
    keys.filter((key) => settings?.[key] !== undefined).map((key) => [key, settings![key]]),
  );

/** A list that was never stored and an empty list mean the same thing. */
const comparable = (value: unknown): unknown => {
  const next = canonical(value ?? null);
  return Array.isArray(next) && next.length === 0 ? null : next;
};

/** Whether any of `keys` differs between the form and what is stored. */
export const replyDiffers = (current: Settings, stored: Settings, keys: string[]): boolean =>
  keys.some((key) => !isEqual(comparable(current?.[key]), comparable(stored?.[key])));

const withoutKeys = (settings: Settings, keys: string[]): Settings =>
  settings
    ? Object.fromEntries(Object.entries(settings).filter(([key]) => !keys.includes(key)))
    : settings;

/**
 * Whether the form holds changes that still need the Save button: everything
 * that differs from the stored values, except the keys that save themselves.
 */
export const hasPendingChanges = (
  values: ChannelValues,
  stored: ChannelValues,
  selfSavingKeys: string[],
): boolean =>
  !isEqual(
    canonical({
      applicationId: values.applicationId,
      credentials: values.credentials,
      settings: withoutKeys(values.settings, selfSavingKeys),
    }),
    canonical({
      applicationId: stored.applicationId,
      credentials: stored.credentials,
      settings: withoutKeys(stored.settings, selfSavingKeys),
    }),
  );
