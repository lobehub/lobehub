/**
 * Human-readable tail of a task detail URL, e.g. `/task/T-501/飞书适配器支持-post-图文消息`.
 *
 * The slug is cosmetic: `taskId` stays the only resolution key, so a stale or
 * hand-edited slug never breaks a link (see `useCanonicalTaskSlug`).
 */

/** Long enough to read the task at a glance, short enough to stay pasteable. */
export const TASK_SLUG_MAX_LENGTH = 60;

const SEPARATOR_RUN = /^-+|-+$/g;

/** Everything that isn't a Unicode letter or digit collapses into one `-`. */
const NON_SLUG_RUN = /[^\p{L}\p{N}]+/gu;

const trimSeparators = (value: string) => value.replaceAll(SEPARATOR_RUN, '');

/**
 * Build the slug segment for a task title.
 *
 * The output is restricted to Unicode letters, digits and `-`, which are all
 * legal in a path segment — so the link needs no percent-encoding and a copied
 * URL stays readable. CJK titles keep their own characters rather than being
 * transliterated: losing them would defeat the point of the slug.
 *
 * Returns `''` for an empty or punctuation-only title, which keeps the URL at
 * its bare `/task/:taskId` form instead of appending a dangling segment.
 */
export const taskTitleSlug = (title?: string | null): string => {
  if (!title) return '';

  const normalized = trimSeparators(
    title.normalize('NFKC').toLowerCase().replaceAll(NON_SLUG_RUN, '-'),
  );

  // Slice by code point, not UTF-16 unit, so a truncation can't cut a surrogate
  // pair in half and leave a lone half-character in the URL.
  const codePoints = [...normalized];
  if (codePoints.length <= TASK_SLUG_MAX_LENGTH) return normalized;

  return trimSeparators(codePoints.slice(0, TASK_SLUG_MAX_LENGTH).join(''));
};
