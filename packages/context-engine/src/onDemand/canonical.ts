import { Md5 } from 'ts-md5';

const encodeCanonical = (value: unknown): string => {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean': {
      return value ? 'true' : 'false';
    }
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new TypeError('Cannot canonicalize a non-finite number.');
      }

      return JSON.stringify(value);
    }
    case 'string': {
      return JSON.stringify(value);
    }
    case 'undefined': {
      return 'null';
    }
    default: {
      break;
    }
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => encodeCanonical(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encodeCanonical(record[key])}`);

    return `{${entries.join(',')}}`;
  }

  throw new TypeError(`Cannot canonicalize value of type ${typeof value}.`);
};

/**
 * JSON-like canonical serialization with sorted object keys. Array order is
 * preserved because it carries protocol meaning.
 */
export const stableStringify = (value: unknown): string => encodeCanonical(value);

export const hashContent = (value: unknown): string =>
  `md5:${Md5.hashStr(stableStringify(value)).toString()}`;
