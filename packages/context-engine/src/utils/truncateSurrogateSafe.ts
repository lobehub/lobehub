/**
 * Truncate a string to at most `maxLength` UTF-16 code units without letting
 * the cut split a surrogate pair.
 *
 * A bare `String#slice` can cut an astral-plane character (e.g. emoji) in
 * half, leaving a lone high surrogate at the end of the result.
 * `JSON.stringify` escapes it as an unpaired `\ud8xx`, which PostgreSQL's
 * jsonb parser rejects — so embedding a naively truncated preview in a jsonb
 * write fails the whole statement. Dropping that final code unit keeps the
 * result valid UTF-16.
 *
 * Scope: this only guards the boundary the cut itself creates (a trailing
 * high surrogate — one that pre-existed at the end of a short input is
 * trimmed the same way). Interior lone surrogates in already-invalid input
 * are `sanitizeUTF8`'s job, not this function's.
 */
export const truncateSurrogateSafe = (content: string, maxLength: number): string => {
  const sliced = content.slice(0, maxLength);
  const lastCode = sliced.charCodeAt(sliced.length - 1);

  // 0xD800–0xDBFF = high surrogate left at the cut, i.e. we split a pair
  return lastCode >= 0xd8_00 && lastCode <= 0xdb_ff ? sliced.slice(0, -1) : sliced;
};
