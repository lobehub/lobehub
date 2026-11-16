import { isIP } from 'node:net';

/** Public callback and client-metadata URLs cannot use local or IP-literal hosts. */
export function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname
    .replaceAll(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (isIP(host)) return false;
  return !['localhost', '.localhost', '.local', '.internal'].some((suffix) =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix,
  );
}
