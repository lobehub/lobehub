/**
 * Ask a row-local message mutation not to send the conversation back.
 *
 * By default (`returnMode` omitted) the server re-reads and returns the whole
 * topic after every update — 100–1000 rows for one edited field. Use this only
 * when the caller already applied the exact change to its local rows
 * (optimistic dispatch) and the server write touches no other row; otherwise
 * keep the default full response and `replaceMessages` it.
 *
 * Lives outside `./index` so modules that mock `@/services/message` keep it.
 */
export const withDeltaReturn = <T extends object>(ctx?: T): T & { returnMode: 'delta' } => ({
  ...(ctx as T),
  returnMode: 'delta',
});
