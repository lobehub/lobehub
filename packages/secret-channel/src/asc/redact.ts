import { ASC_MIN_REDACT_LENGTH as MIN_REDACT_LENGTH } from './constants';
import { toBase64Url, utf8Encode } from './encoding';

/** Label charset kept conservative so the placeholder itself can never smuggle content. */
export const sanitizeSecretLabel = (label: string): string =>
  label
    .normalize('NFKC')
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40) || 'secret';

/** The only representation of a secret allowed in DB, model context and traces (spec §7.4). */
export const formatSecretPlaceholder = (label: string) => `«secret:${sanitizeSecretLabel(label)}»`;

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

const toBase64 = (bytes: Uint8Array) => {
  const url = toBase64Url(bytes);
  return url.replaceAll('-', '+').replaceAll('_', '/');
};

/**
 * Encoded forms under which a secret commonly re-appears in output: raw, URL-encoded, JSON-escaped,
 * base64 (std/url, with and without padding), hex (lower/upper).
 */
export const secretVariants = (value: string): string[] => {
  const bytes = utf8Encode(value);
  const b64 = toBase64(bytes);
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const hex = toHex(bytes);
  const variants = new Set([
    value,
    encodeURIComponent(value),
    JSON.stringify(value).slice(1, -1),
    b64,
    padded,
    toBase64Url(bytes),
    hex,
    hex.toUpperCase(),
  ]);
  return [...variants].filter((variant) => variant.length >= MIN_REDACT_LENGTH);
};

export interface SecretRedactor {
  /** Register a delivered secret for this operation. */
  add: (label: string, value: string) => void;
  /** Forget every registered value (operation ended). */
  clear: () => void;
  /** Length of the longest registered variant. */
  readonly maxLength: number;
  /**
   * Length of the longest trailing run of `text` that is a proper prefix of a registered variant:
   * the raw text a streaming caller must hold back because a match may still complete.
   */
  partialSuffixLength: (text: string) => number;
  redact: (text: string) => string;
  readonly size: number;
}

/**
 * Executor-side known-value redactor (spec §7.4). One instance per operation.
 * It only defeats accidental echo; adversarial transforms (rev, xor, split printing) are out of
 * scope and documented as a limitation.
 */
export const createSecretRedactor = (): SecretRedactor => {
  let patterns: { placeholder: string; variant: string }[] = [];

  return {
    add(label, value) {
      // No whole-value length guard here: `secretVariants` already drops the representations
      // shorter than the minimum. Gating on the raw value would skip a short secret's longer
      // encodings too (e.g. `abc` → `YWJj`, `616263`), leaving them in the output unredacted.
      const placeholder = formatSecretPlaceholder(label);
      for (const variant of secretVariants(value)) patterns.push({ placeholder, variant });
      // Longest first so a raw value inside its own longer encoding is handled by the longer match.
      patterns.sort((a, b) => b.variant.length - a.variant.length);
    },
    clear() {
      patterns = [];
    },
    get maxLength() {
      return patterns[0]?.variant.length ?? 0;
    },
    partialSuffixLength(text) {
      // Only a *proper* prefix has to wait: a suffix that already equals a whole variant can be
      // redacted now unless a longer variant starts with it. Patterns are sorted longest first.
      const longestPrefix = Math.max(0, (patterns[0]?.variant.length ?? 0) - 1);
      let hold = 0;
      for (let length = 1; length <= Math.min(text.length, longestPrefix); length++) {
        const suffix = text.slice(text.length - length);
        if (patterns.some((p) => p.variant.length > length && p.variant.startsWith(suffix)))
          hold = length;
      }
      return hold;
    },
    redact(text) {
      let out = text;
      for (const { placeholder, variant } of patterns) {
        if (out.includes(variant)) out = out.split(variant).join(placeholder);
      }
      return out;
    },
    get size() {
      return patterns.length;
    },
  };
};

/**
 * Chunk-boundary-safe wrapper for stdout/stderr streams. It holds back only the raw characters a
 * match may still be completed from, so redaction runs on the prefix that is already decided.
 * Redacting before deciding consumes a shorter variant that is the prefix of a longer one and
 * leaks the longer one's suffix: given `abcd` and `abcdef`, `push('abcd')` then `push('ef')` must
 * yield `«secret:long»`, not `«secret:short»ef`. Call `flush()` at end of stream.
 */
export const createStreamingRedactor = (redactor: SecretRedactor) => {
  let pending = '';
  return {
    flush(): string {
      const out = redactor.redact(pending);
      pending = '';
      return out;
    },
    push(chunk: string): string {
      pending += chunk;
      const cut = pending.length - redactor.partialSuffixLength(pending);
      if (cut <= 0) return '';
      const head = pending.slice(0, cut);
      pending = pending.slice(cut);
      return redactor.redact(head);
    },
  };
};
