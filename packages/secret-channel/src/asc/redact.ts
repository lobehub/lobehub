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

/**
 * Wrap a placeholder in `separator`, between every pair of adjacent characters and around both
 * ends. With a separator that appears in none of the Run's variants no variant can appear inside
 * the result, and none can cross from the neighbouring text into it either (spec §7.4,
 * [ASC-L3-09]).
 */
const wrapPlaceholder = (placeholder: string, separator: string): string =>
  `${separator}${[...placeholder].join(separator)}${separator}`;

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
  redact: (text: string) => string;
  /**
   * Redact the decided leading part of `text` and return the raw `carry` re-fed with the next
   * chunk. Matches resolve left to right, and any suffix a longer variant may still complete from
   * stays raw, so `carry` is always shorter than the longest variant: a stream buffers at most one
   * variant's worth, and a match is never split across the boundary or emitted with its own prefix
   * already redacted. With overlapping variants the result may differ from `redact` on the same
   * text, but it never re-emits a registered variant.
   */
  redactDecided: (text: string) => { carry: string; out: string };
  readonly size: number;
}

/**
 * Executor-side known-value redactor (spec §7.4). One instance per operation.
 * It only defeats accidental echo; adversarial transforms (rev, xor, split printing) are out of
 * scope and documented as a limitation.
 */
export const createSecretRedactor = (): SecretRedactor => {
  let patterns: { label: string; variant: string }[] = [];
  // Variants bucketed by first character so the streaming scan only compares plausible candidates.
  let byFirst = new Map<string, { label: string; variant: string }[]>();
  let placeholders = new Map<string, string>();

  const index = () => {
    byFirst = new Map();
    for (const pattern of patterns) {
      const bucket = byFirst.get(pattern.variant[0]);
      if (bucket) bucket.push(pattern);
      else byFirst.set(pattern.variant[0], [pattern]);
    }
  };

  /** A character that appears in no registered variant, so escaping with it cannot be matched. */
  const pickSeparator = () => {
    const used = new Set([...patterns.map((p) => p.variant).join('')]);
    for (let code = 0x200b; code <= 0x10ffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue; // lone surrogates
      const candidate = String.fromCodePoint(code);
      if (!used.has(candidate)) return candidate;
    }
    /* c8 ignore next -- the union of a Run's variants never covers every code point */
    return '·';
  };

  /**
   * A placeholder must not carry a delivered secret: neither inside itself (a secret equal to, or
   * inside, `secret` or the label) nor composed with the text beside it (a secret like `»abcdef`
   * formed by the closing `»` and the `abcdef` that follows the placeholder). The plain §7.4 form
   * is kept while neither can happen; otherwise the same characters are wrapped in a separator that
   * appears in none of the Run's variants, which no variant can contain or cross.
   */
  const refreshPlaceholders = () => {
    placeholders = new Map();
    const edges = patterns.some((p) => p.variant.includes('«') || p.variant.includes('»'));
    for (const { label } of patterns) {
      const plain = formatSecretPlaceholder(label);
      const collides = edges || patterns.some((p) => plain.includes(p.variant));
      placeholders.set(label, collides ? wrapPlaceholder(plain, pickSeparator()) : plain);
    }
  };

  const redactText = (text: string) => {
    let out = text;
    for (const { label, variant } of patterns) {
      const placeholder = placeholders.get(label) ?? formatSecretPlaceholder(label);
      if (out.includes(variant)) out = out.split(variant).join(placeholder);
    }
    return out;
  };

  return {
    add(label, value) {
      // No whole-value length guard here: `secretVariants` already drops the representations
      // shorter than the minimum. Gating on the raw value would skip a short secret's longer
      // encodings too (e.g. `abc` → `YWJj`, `616263`), leaving them in the output unredacted.
      for (const variant of secretVariants(value)) patterns.push({ label, variant });
      // Longest first so a raw value inside its own longer encoding is handled by the longer match.
      patterns.sort((a, b) => b.variant.length - a.variant.length);
      index();
      refreshPlaceholders();
    },
    clear() {
      patterns = [];
      index();
      refreshPlaceholders();
    },
    get maxLength() {
      return patterns[0]?.variant.length ?? 0;
    },
    redact: redactText,
    redactDecided(text) {
      const length = text.length;
      const longest = patterns[0]?.variant.length ?? 0;
      if (longest === 0) return { carry: '', out: text };

      let out = '';
      let decided = 0;
      let at = 0;
      while (at < length) {
        // Only a suffix shorter than the longest variant can still be completed into a match.
        const remaining = length - at;
        if (
          remaining < longest &&
          patterns.some((p) => p.variant.length > remaining && p.variant.startsWith(text.slice(at)))
        )
          break;
        const match = byFirst.get(text[at])?.find((p) => text.startsWith(p.variant, at));
        if (match) {
          const placeholder = placeholders.get(match.label) ?? formatSecretPlaceholder(match.label);
          out += redactText(text.slice(decided, at)) + placeholder;
          at += match.variant.length;
          decided = at;
        } else {
          at += 1;
        }
      }
      out += redactText(text.slice(decided, at));
      return { carry: text.slice(at), out };
    },
    get size() {
      return patterns.length;
    },
  };
};

/**
 * Chunk-boundary-safe wrapper for stdout/stderr streams. It redacts only the prefix whose matches
 * are already decided and carries the raw suffix into the next chunk, so a secret split across
 * chunks is still caught and the buffer never exceeds one variant. Call `flush()` at end of stream.
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
      const { carry, out } = redactor.redactDecided(pending + chunk);
      pending = carry;
      return out;
    },
  };
};
