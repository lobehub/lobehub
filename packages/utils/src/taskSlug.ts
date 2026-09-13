/**
 * Human-readable tail of a task detail URL, e.g. `/task/T-501/飞书适配器支持-post-图文消息`.
 *
 * The slug is cosmetic: `taskId` stays the only resolution key, so a stale or
 * hand-edited slug never breaks a link (see `useCanonicalTaskSlug`).
 */

/** Long enough to read the task at a glance, short enough to stay pasteable. */
export const TASK_SLUG_MAX_LENGTH = 60;

/**
 * Ceiling on the code points a slug may carry, independent of how many
 * graphemes that is.
 *
 * Grapheme counting alone is not a size bound: a single cluster accepts an
 * unlimited run of combining marks, so `a` plus 10k accents is one grapheme and
 * a ~20KB path segment — past what browsers and proxies accept in a request
 * line. Titles arrive from imported and generated content, so the bound has to
 * hold for input nobody typed by hand.
 */
const TASK_SLUG_MAX_CODE_POINTS = 4 * TASK_SLUG_MAX_LENGTH;

const SEPARATOR_RUN = /^-+|-+$/g;

/**
 * Everything that isn't a Unicode letter, digit or combining mark collapses
 * into one `-`.
 *
 * `\p{M}` is not decoration: Devanagari matras, Thai vowel signs and Arabic
 * harakat are separate code points that NFKC does not fold into their base
 * letter, so dropping marks shreds those scripts one character at a time
 * (`कार्य पूरा करें` → `क-र-य-प-र-कर`). CJK happened to be unaffected, which is
 * why the original character class read as correct.
 */
const NON_SLUG_RUN = /[^\p{L}\p{N}\p{M}]+/gu;

const trimSeparators = (value: string) => value.replaceAll(SEPARATOR_RUN, '');

/**
 * Grapheme segmenter, built once — constructing one per call shows up on list
 * renders that build a link per row. `undefined` locale is deliberate: grapheme
 * boundaries are locale-independent for the scripts this has to protect.
 */
const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;

/**
 * Split into user-perceived characters. Falls back to code points where
 * `Intl.Segmenter` is missing (Firefox < 125, older runtimes) — that still
 * keeps surrogate pairs intact, it just can't protect combining marks.
 */
const toGraphemes = (value: string): string[] =>
  graphemeSegmenter
    ? [...graphemeSegmenter.segment(value)].map((entry) => entry.segment)
    : [...value];

/**
 * Build the slug segment for a task title.
 *
 * The output is restricted to Unicode letters, digits, combining marks and `-`,
 * which are all legal in a path segment — so the link needs no percent-encoding
 * and a copied URL stays readable. CJK titles keep their own characters rather
 * than being transliterated: losing them would defeat the point of the slug.
 *
 * Returns `''` for an empty or punctuation-only title, which keeps the URL at
 * its bare `/task/:taskId` form instead of appending a dangling segment.
 */
export const taskTitleSlug = (title?: string | null): string => {
  if (!title) return '';

  const normalized = trimSeparators(
    title.normalize('NFKC').toLowerCase().replaceAll(NON_SLUG_RUN, '-'),
  );

  // Slice by grapheme cluster, not UTF-16 unit or code point: a cut mid-cluster
  // either halves a surrogate pair or strands a combining mark without its base
  // letter, both of which put a broken character in the URL.
  const graphemes = toGraphemes(normalized);
  const kept: string[] = [];
  let codePoints = 0;

  for (const grapheme of graphemes) {
    if (kept.length >= TASK_SLUG_MAX_LENGTH) break;

    const size = [...grapheme].length;
    // Keep whole clusters only: dropping the one that would breach the ceiling
    // beats emitting a half-cluster to fill the remaining budget.
    if (codePoints + size > TASK_SLUG_MAX_CODE_POINTS) break;

    kept.push(grapheme);
    codePoints += size;
  }

  if (kept.length === graphemes.length) return normalized;

  return trimSeparators(kept.join(''));
};
