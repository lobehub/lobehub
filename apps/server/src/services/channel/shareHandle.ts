/** Share handles are stored lowercase; accept `@handle`, `/a/handle` and full share URLs. */
export const parseShareHandle = (query: string): string | undefined => {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const fromPath = trimmed.match(/\/a\/([^/?#\s]+)/);
  const handle = (fromPath ? decodeURIComponent(fromPath[1]) : trimmed).replace(/^@/, '');
  return handle || undefined;
};
