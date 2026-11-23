import {
  BRANDING_NAME,
  BRANDING_PROVIDER,
  BRANDING_PROVIDER_DISPLAY_ID,
  LOBE_CHAT_CLOUD,
} from '@lobechat/business-const';

const BRAND_KEY_PATTERN = /lobe(?:hub|chat)/i;
const BRAND_TEXT_PATTERN = /lobe(?:hub\s+cloud|hub|chat)/gi;
const PROVIDER_FIELD_KEYS = new Set(['provider', 'provider_id', 'providerid']);

const isCustomBranded = (): boolean =>
  (BRANDING_NAME as string) !== 'LobeHub' || Boolean(BRANDING_PROVIDER_DISPLAY_ID);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value instanceof Error || value instanceof Date || value instanceof RegExp) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Whether `provider` refers to the deployment's built-in branded provider —
 * either its persisted runtime ID (`BRANDING_PROVIDER`) or its display ID
 * (`BRANDING_PROVIDER_DISPLAY_ID`).
 */
export const isBrandedProviderId = (provider?: string | null): boolean => {
  if (!provider) return false;
  const normalized = provider.toLowerCase();
  if (normalized === BRANDING_PROVIDER.toLowerCase()) return true;
  return (
    Boolean(BRANDING_PROVIDER_DISPLAY_ID) &&
    normalized === BRANDING_PROVIDER_DISPLAY_ID.toLowerCase()
  );
};

/**
 * Resolve the user-facing identifier for a provider ID.
 * - Default built-in provider (`BRANDING_PROVIDER`): returns
 *   `BRANDING_PROVIDER_DISPLAY_ID` when configured, else `BRANDING_NAME` on
 *   custom-branded builds, else the raw ID.
 * - Third-party or custom providers: returned unchanged.
 */
export const getProviderDisplayIdentifier = (provider: string): string => {
  if (!provider) return provider;
  if (provider.toLowerCase() === BRANDING_PROVIDER.toLowerCase()) {
    if (BRANDING_PROVIDER_DISPLAY_ID) return BRANDING_PROVIDER_DISPLAY_ID;
    if ((BRANDING_NAME as string) !== 'LobeHub') return BRANDING_NAME;
  }
  return provider;
};

/**
 * Map a display provider ID back to its runtime/route provider ID when needed
 * (e.g. `/settings/provider/<id>`).
 */
export const toRuntimeProviderId = (provider?: string): string | undefined => {
  if (!provider) return provider;
  if (
    BRANDING_PROVIDER_DISPLAY_ID &&
    provider.toLowerCase() === BRANDING_PROVIDER_DISPLAY_ID.toLowerCase()
  ) {
    return BRANDING_PROVIDER;
  }
  return provider;
};

/**
 * Replace upstream brand literals (`LobeHub Cloud`, `LobeHub`, `LobeChat`,
 * case-insensitive) inside arbitrary error strings with this distribution's
 * brand name. No-op under default LobeHub branding.
 */
export const sanitizeBrandErrorText = (text: string): string => {
  if (!isCustomBranded() || !BRAND_KEY_PATTERN.test(text)) return text;

  return text.replaceAll(BRAND_TEXT_PATTERN, (match) =>
    /cloud$/i.test(match) ? LOBE_CHAT_CLOUD : BRANDING_NAME,
  );
};

const sanitizeStringValue = (text: string, seen: WeakSet<object>): string => {
  if (!BRAND_KEY_PATTERN.test(text)) return text;

  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        return JSON.stringify(sanitizeValue(parsed, seen));
      }
    } catch {
      // Not valid JSON — fall through to plain text sanitization.
    }
  }

  return sanitizeBrandErrorText(text);
};

const sanitizeValue = (value: unknown, seen: WeakSet<object>): unknown => {
  if (typeof value === 'string') return sanitizeStringValue(value, seen);
  if (!value || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    try {
      return value.map((item) => sanitizeValue(item, seen));
    } finally {
      seen.delete(value);
    }
  }

  if (!isPlainObject(value)) return value;
  if (seen.has(value)) return undefined;

  seen.add(value);
  try {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      // Drop any key whose name exposes the upstream brand (e.g. `lobehub_trace`, `x-lobehub-id`).
      if (BRAND_KEY_PATTERN.test(key)) continue;

      if (PROVIDER_FIELD_KEYS.has(key.toLowerCase()) && typeof entryValue === 'string') {
        sanitized[key] =
          entryValue.toLowerCase() === BRANDING_PROVIDER.toLowerCase()
            ? getProviderDisplayIdentifier(entryValue)
            : sanitizeBrandErrorText(entryValue);
        continue;
      }

      sanitized[key] = sanitizeValue(entryValue, seen);
    }
    return sanitized;
  } finally {
    seen.delete(value);
  }
};

/**
 * Recursively sanitize an error payload before sending it to clients or
 * rendering it in UI details:
 * 1. Drops keys whose name contains `lobehub` / `lobechat` (case-insensitive).
 * 2. Rewrites default built-in provider fields (`provider`, `providerId`,
 *    `provider_id` equal to `BRANDING_PROVIDER`) to `BRANDING_PROVIDER_DISPLAY_ID`
 *    (falling back to `BRANDING_NAME`), while leaving other/custom providers intact.
 * 3. Rewrites remaining `LobeHub` / `LobeChat` mentions in string values to
 *    `BRANDING_NAME` (and `LobeHub Cloud` to `LOBE_CHAT_CLOUD`).
 *
 * No-op under default LobeHub branding.
 */
export const sanitizeErrorPayloadForDisplay = <T>(value: T): T => {
  if (!isCustomBranded()) return value;
  return sanitizeValue(value, new WeakSet()) as T;
};
