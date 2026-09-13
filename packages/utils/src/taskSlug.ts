/**
 * Human-readable tail of a task detail URL, e.g. `/task/T-501/飞书适配器支持-post-图文消息`.
 *
 * The slug is cosmetic: `taskId` stays the only resolution key, so a stale or
 * hand-edited slug never breaks a link (see `useCanonicalTaskSlug`).
 */

/** Long enough to read the task at a glance, short enough to stay pasteable. */
export const TASK_SLUG_MAX_LENGTH = 60;

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

/** The two fields a task slug may be built from, in fallback order. */
export interface TaskSlugTitleSource {
  instruction?: string | null;
  name?: string | null;
}

/**
 * Resolve the title a task's slug is built from.
 *
 * Mirrors the server-side `COALESCE(tasks.name, tasks.instruction)` that the
 * Recent feed applies (`packages/database/src/models/recent.ts`), so a link
 * built from a list row and the URL `useCanonicalTaskSlug` canonicalises to
 * agree. They disagreed before: Recent linked a nameless task to
 * `/task/:id/<instruction-slug>` and the canonicaliser, reading `name` alone,
 * immediately flattened it back to `/task/:id`.
 *
 * `??` and not `||`, again to match `COALESCE`: a name cleared to `''` is a
 * resolved "no title" state that must collapse the URL, not fall through to the
 * instruction. `'Untitled Task'` is display copy and deliberately not part of
 * this chain — it must never reach a URL.
 */
export const taskSlugTitle = (task?: TaskSlugTitleSource | null): string =>
  task?.name ?? task?.instruction ?? '';

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
  if (graphemes.length <= TASK_SLUG_MAX_LENGTH) return normalized;

  return trimSeparators(graphemes.slice(0, TASK_SLUG_MAX_LENGTH).join(''));
};
