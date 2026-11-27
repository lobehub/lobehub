export type JsonSafeValue =
  boolean | null | number | string | readonly JsonSafeValue[] | JsonSafeObject;

export interface JsonSafeObject {
  readonly [key: string]: JsonSafeValue;
}

export const safeJsonStringify = (value: unknown): string => {
  const ancestors: object[] = [];

  try {
    return (
      JSON.stringify(value, function (_key, item) {
        if (typeof item === 'bigint') return item.toString();
        if (typeof item === 'object' && item !== null) {
          // Only ancestors are cycles; repeated siblings still carry their full data.
          while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop();
          if (ancestors.includes(item)) return '[Circular]';
          ancestors.push(item);
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
