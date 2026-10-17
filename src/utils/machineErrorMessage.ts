/**
 * A message the server never wrote for anyone to read.
 *
 * Drizzle raises a failed statement with the whole query and its bound
 * parameters in `message` (`Failed query: <sql>` / `params: <values>`), and
 * tRPC forwards that verbatim; a stack trace can tag along the same way.
 * Neither is something a person can act on — and the bound values can carry
 * their own input back at them — so callers drop them in favour of their own
 * copy for the action that failed.
 *
 * Matched narrowly on purpose. Refusals the server *did* write as sentences
 * must still reach the person, so "anything long" or "anything with a newline"
 * is not a signal.
 */
export const isMachineErrorMessage = (message: string): boolean =>
  message.startsWith('Failed query:') ||
  // A stack trace that came along for the ride.
  /\n\s+at\s/.test(message);
