/** PostgreSQL's POSIX space class omits some Unicode whitespace, including NBSP. */
export const SEARCHABLE_TEXT_SQL_PATTERN = String.raw`U&'[^[:space:]\00A0\1680\2000-\200A\2028\2029\202F\205F\FEFF]'`;
