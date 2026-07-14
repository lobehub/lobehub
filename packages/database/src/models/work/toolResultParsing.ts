import type { RegisterExternalWorkParams } from '@lobechat/types';
import { toRecord } from '@lobechat/utils';

/**
 * Parsing primitives shared by the provider tool-result normalizers
 * (githubToolResult.ts / linearToolResult.ts). Keep provider-specific
 * variants (e.g. github's digit-string-aware numberValue) in their own files.
 */

export { toRecord };

/**
 * The single register operation every provider normalizer emits. Providers only
 * differ in how they parse their tool result into `RegisterExternalWorkParams`;
 * the resulting operation shape is unified.
 */
export interface ExternalToolWorkOperation {
  params: Omit<RegisterExternalWorkParams, 'toolIdentifier'>;
  type: 'register';
}

export const parseMaybeJSON = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const stringValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed || null;
};

export const hasOwn = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

export const fromRecord = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }

  return null;
};

export const isApplicationError = (data: unknown) => {
  const record = toRecord(parseMaybeJSON(data));
  return record?.isError === true;
};

/**
 * Allowlist an external Work URL to the `http`/`https` schemes before it is
 * persisted into a Work snapshot.
 *
 * Work URLs are member-controlled free text: Linear results carry a `url` /
 * `appUrl` field and GitHub URLs are parsed out of `gh` CLI stdout, so a
 * workspace member can plant an arbitrary scheme (`javascript:`, `data:`,
 * `file:`, custom protocols). Another member later clicking that Work card in
 * the desktop (Electron) app hits `window.open` → `shell.openExternal`, which
 * would turn the stored string into script execution or local-file access.
 * Rejecting non-http(s) URLs here is the authoritative write-time boundary;
 * render-time guards add defense in depth.
 *
 * @returns the trimmed URL when it parses via `new URL()` and uses the
 *   `http:`/`https:` protocol, otherwise `undefined` (so the caller skips it).
 */
export const sanitizeExternalUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const { protocol } = new URL(trimmed);
    if (protocol === 'http:' || protocol === 'https:') return trimmed;
  } catch {
    return undefined;
  }

  return undefined;
};
