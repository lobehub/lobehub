/**
 * CUST-007: 只允许站内相对路径，防止 callback 变成开放重定向。
 */
const UNSAFE_CHARS = /[\r\n\\]/;

export function resolveSafeRedirect(target: string | undefined, fallback = '/'): string {
  if (!target) return fallback;

  const value = target.trim();
  if (!value.startsWith('/') || value.startsWith('//') || UNSAFE_CHARS.test(value)) {
    return fallback;
  }

  return value;
}
