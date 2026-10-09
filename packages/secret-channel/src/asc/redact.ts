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
   * Largest prefix length of `text` a streaming caller may finalize: everything before it can be
   * redacted and dropped without consuming a match that is still open at the cut — neither a
   * completed match straddling it nor a suffix that is a proper prefix of a longer variant. `0`
   * means the whole buffer is still ambiguous and must be held back.
   */
  finalizablePrefixLength: (text: string) => number;
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
    finalizablePrefixLength(text) {
      const length = text.length;
      // Patterns are sorted longest first, so only the last `longest - 1` characters can be a
      // proper prefix of a variant.
      const longest = patterns[0]?.variant.length ?? 0;
      if (longest === 0) return length;

      // Hold back any trailing run that is a proper prefix of a variant: a longer match may still
      // complete from it, so redacting it now would consume that match's prefix.
      let cut = length;
      for (let start = Math.max(0, length - (longest - 1)); start < length; start++) {
        const tail = text.slice(start);
        if (patterns.some((p) => p.variant.length > tail.length && p.variant.startsWith(tail))) {
          cut = start;
          break;
        }
      }

      // Never cut through a completed match either: a match that starts before the cut and ends
      // after it would have its start emitted un-redacted (`abcd` then `ef` for a longer `abcdef`).
      // Move the cut back to the start of any such match until none straddles it.
      let straddled = true;
      while (straddled) {
        straddled = false;
        for (const { variant } of patterns) {
          for (
            let at = text.indexOf(variant);
            at !== -1 && at < cut;
            at = text.indexOf(variant, at + 1)
          ) {
            if (at + variant.length > cut) {
              cut = at;
              straddled = true;
              break;
            }
          }
          if (straddled) break;
        }
      }
      return cut;
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
 * Chunk-boundary-safe wrapper for stdout/stderr streams. It finalizes only the prefix a match can
 * no longer reach, then redacts it, so redaction never consumes raw text a later chunk still needs.
 * Call `flush()` at end of stream.
 *
 * Two naive framings leak and are guarded against here:
 * - redacting `pending + chunk` before keeping the boundary window consumes a shorter variant that
 *   is the prefix of a longer one: `push('abcd')` then `push('ef')` must yield `«secret:long»`,
 *   not `«secret:short»ef`;
 * - cutting at a fixed offset bisects a completed match that overlaps a trailing prefix: with
 *   `abcdef` and `efgh`, `push('abcdefg')` must not emit `abcd` and retain `efg`.
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
      const cut = redactor.finalizablePrefixLength(pending);
      if (cut <= 0) return '';
      const head = pending.slice(0, cut);
      pending = pending.slice(cut);
      return redactor.redact(head);
    },
  };
};
