import { v4 as uuidv4 } from 'uuid';

export interface KeyValueItem {
  id: string;
  key: string;
  value: string;
}

export const recordToLocalList = (
  record: Record<string, string> | undefined | null = {},
): KeyValueItem[] =>
  Object.entries(record || {}).map(([key, val]) => ({
    id: uuidv4(),
    key,
    value: typeof val === 'string' ? val : '',
  }));

export const localListToRecord = (
  list: KeyValueItem[] | undefined | null = [],
): Record<string, string> => {
  const record: Record<string, string> = {};
  const keys = new Set<string>();
  (list || [])
    .slice()
    .reverse()
    .forEach((item) => {
      const trimmedKey = item.key.trim();
      if (trimmedKey && !keys.has(trimmedKey)) {
        record[trimmedKey] = typeof item.value === 'string' ? item.value : '';
        keys.add(trimmedKey);
      }
    });
  return Object.keys(record)
    .reverse()
    .reduce(
      (acc, key) => {
        acc[key] = record[key];
        return acc;
      },
      {} as Record<string, string>,
    );
};
