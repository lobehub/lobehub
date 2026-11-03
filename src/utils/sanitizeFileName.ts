const DEFAULT_MAX_LENGTH = 50;

/**
 * Sanitize user input for use as a file name.
 * Strips path separators and control characters, keeping alphanumeric,
 * CJK, spaces and hyphens. Falls back to `fallback` when the result is empty.
 */
export function sanitizeFileName(
  input: string,
  fallback: string,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  const sanitized = input
    .replaceAll(/[^\w\u4E00-\u9FFF -]/g, '_')
    .trim()
    .slice(0, maxLength);

  return sanitized || fallback;
}
