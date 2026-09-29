/**
 * Identity exposed by hook events, never the account used for permissions or storage.
 * Pass only the trusted runtime share context (normalized state principal or host context),
 * never tool arguments, request payloads, or message content.
 */
export const resolveHookUserId = <T extends string | undefined>(
  userId: T,
  shareVisitor?: { visitorUserId?: string } | null,
): string | T => shareVisitor?.visitorUserId ?? userId;
