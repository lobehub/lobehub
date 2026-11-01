const UUID_RE = /^[\dA-F]{8}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{12}$/i;

/**
 * Whether a string is a well-formed UUID. External ids (URL params, chat
 * links) reach uuid-typed columns as-is, and Postgres aborts the whole query
 * with 22P02 on a malformed value — surfacing as a 500 instead of "not found".
 * Autolinkers gluing trailing CJK punctuation onto a shared link is the common
 * real-world producer of such ids.
 */
export const isUuid = (value: string): boolean => UUID_RE.test(value);
