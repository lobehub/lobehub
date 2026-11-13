export interface ArgumentEntry {
  key: string;
  value: string;
}

const MAX_VALUE_LENGTH = 80;

const stringifyValue = (value: unknown): string => {
  if (value === null || value === undefined) return '--';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null))
    return value.map((item) => stringifyValue(item)).join(', ');
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * Subscription arguments as readable `key: value` pairs, in the order the
 * agent wrote them. Arguments are the subscription's filter (which repository,
 * which team), so the approval card lists every one of them.
 */
export const formatArgumentEntries = (args: Record<string, unknown> | null | undefined) =>
  Object.entries(args ?? {}).map<ArgumentEntry>(([key, value]) => ({
    key,
    value: stringifyValue(value),
  }));

/**
 * A one-line summary of the arguments for a list row: the first few pairs,
 * long values clipped, the rest counted. `undefined` when there are none, so
 * the caller can say "every event" instead of printing an empty string.
 */
export const summarizeArguments = (
  args: Record<string, unknown> | null | undefined,
  maxEntries = 2,
): { more: number; text: string } | undefined => {
  const entries = formatArgumentEntries(args);
  if (entries.length === 0) return undefined;

  const shown = entries.slice(0, maxEntries).map(({ key, value }) => {
    const clipped =
      value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
    return `${key}: ${clipped}`;
  });

  return { more: entries.length - shown.length, text: shown.join(' · ') };
};
