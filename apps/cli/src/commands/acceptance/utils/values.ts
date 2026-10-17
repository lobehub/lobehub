/** Readers for loosely shaped report JSON written by agents. */

export function firstString(...values: unknown[]): string | undefined {
  return values.find((v): v is string => typeof v === 'string' && v.length > 0);
}

export function firstStringOrNumber(...values: unknown[]): string | number | undefined {
  return values.find(
    (v): v is string | number => (typeof v === 'string' && v.length > 0) || typeof v === 'number',
  );
}

export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function safeWebUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
