/**
 * Reports whether granted Gmail OAuth scopes permit message reads.
 *
 * Use when:
 * - A connector must verify Gmail evidence can be collected before starting work
 * - An authorization callback must distinguish a connected account from a readable account
 *
 * Expects:
 * - Full OAuth scope URLs or equivalent scope identifiers
 *
 * Returns:
 * - `true` for Gmail read-only, modify, or full-mail access
 */
export const hasGmailReadPermission = (scopes: readonly string[]): boolean =>
  scopes.some((scope) => GMAIL_READ_SCOPES.has(scope.trim()));
/** Google OAuth scopes that permit reading Gmail message content. */
const GMAIL_READ_SCOPES = new Set([
  'gmail.modify',
  'gmail.readonly',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
]);
