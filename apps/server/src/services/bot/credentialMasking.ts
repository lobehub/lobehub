import { BOT_CREDENTIAL_MASK, isMaskedBotCredential } from '@lobechat/const';

import { platformRegistry } from './platforms';

/** Re-exported so server code has one import for the whole masking concern. */
export const CREDENTIAL_MASK = BOT_CREDENTIAL_MASK;

/**
 * Credential keys a platform publishes as identifiers rather than secrets.
 *
 * Derived from the form schema, where `type: 'password'` already marks what a
 * UI must not render in the clear — Discord's `publicKey` is a public key,
 * its `botToken` is not. Platforms whose credentials never come from a form
 * (WeChat fills them from the QR handshake) declare the identifiers through
 * `publicCredentialKeys` instead, since they have no schema to read.
 *
 * Anything not named here is treated as secret. Fail-closed is the point: a new
 * platform that forgets to classify a field leaks nothing.
 */
const publicCredentialKeys = (platform: string): Set<string> => {
  const entry = platformRegistry.getPlatform(platform);
  const declared = entry?.schema?.find((field) => field.key === 'credentials');

  const fromSchema = (declared?.properties ?? [])
    .filter((field) => field.type !== 'password')
    .map((field) => field.key);

  return new Set([...fromSchema, ...(entry?.publicCredentialKeys ?? [])]);
};

/**
 * Replace every secret value with {@link CREDENTIAL_MASK}, keeping the keys.
 *
 * The shape has to survive: a reader still needs to see which credentials are
 * configured and which are blank, and that is exactly what an empty value
 * already communicates — so empties are passed through untouched rather than
 * masked into looking set.
 */
export const maskCredentials = (
  platform: string,
  credentials: Record<string, string> | null | undefined,
): Record<string, string> => {
  if (!credentials) return {};

  const isPublic = publicCredentialKeys(platform);

  return Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => {
      if (isPublic.has(key)) return [key, value];
      if (!value) return [key, value];
      return [key, CREDENTIAL_MASK];
    }),
  );
};

/**
 * Rebuild the credential blob a masked edit form sends back.
 *
 * The model replaces credentials wholesale, so a form that read masks and
 * submitted them unchanged would otherwise persist the mask as the secret, and
 * merely dropping the masked keys would delete the secrets instead. Each masked
 * entry therefore resolves to the stored value it was standing in for; a key
 * with no stored value behind it is dropped, because a mask is not a secret.
 */
export const resolveMaskedCredentials = (
  submitted: Record<string, string>,
  stored: Record<string, string> | null | undefined,
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(submitted)) {
    // Recognised through the shared predicate, which ignores surrounding
    // whitespace. An exact comparison here would disagree with the form, which
    // accepts a padded placeholder as unchanged — and the half-millimetre
    // between those two readings is a real secret being overwritten by dots.
    if (!isMaskedBotCredential(value)) {
      result[key] = value;
      continue;
    }

    const previous = stored?.[key];
    if (previous !== undefined) result[key] = previous;
  }

  return result;
};

/** Whether the caller handed us a mask where a real secret was required. */
export const containsMaskedCredential = (
  credentials: Record<string, string> | null | undefined,
): boolean => Object.values(credentials ?? {}).some((value) => isMaskedBotCredential(value));
