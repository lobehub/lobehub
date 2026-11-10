export type JsonSafeValue =
  boolean | null | number | string | readonly JsonSafeValue[] | JsonSafeObject;

export interface JsonSafeObject {
  readonly [key: string]: JsonSafeValue;
}

export const safeJsonStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();

  try {
    return (
      JSON.stringify(value, (_key, item) => {
        if (typeof item === 'bigint') return item.toString();
        if (typeof item === 'object' && item !== null) {
          if (seen.has(item as object)) return '[Circular]';
          seen.add(item as object);
        }
        return item;
      }) ?? 'null'
    );
  } catch {
    return JSON.stringify({
      message: 'Failed to serialize JSON value',
      name: 'JsonSerializationFailure',
    });
  }
};

export const toJsonSafe = (value: unknown): JsonSafeValue => {
  try {
    return JSON.parse(safeJsonStringify(value)) as JsonSafeValue;
  } catch {
    return String(value);
  }
};
