import { set } from 'es-toolkit/compat';

import { type MetaData } from '@/types/meta';

/**
 * Keys from MetaData that should be separated from LobeAgentConfig when parsing
 * DEFAULT_AGENT_CONFIG. If MetaData gains new fields, add them here.
 *
 * `marketIdentifier` is intentionally excluded — it's not user-configurable via env var.
 *
 * The typed array literal ensures a compile error if a key is misspelled or
 * removed from MetaData. The Set itself is `Set<string>` so `.has()` accepts
 * any string without requiring a cast.
 */
const META_KEY_LIST: (keyof MetaData)[] = [
  'avatar',
  'backgroundColor',
  'description',
  'title',
  'tags',
];
const META_KEYS: Set<string> = new Set(META_KEY_LIST);

/**
 * User-friendly aliases mapped to their canonical MetaData key.
 * `displayName` is more intuitive in env vars than `title`.
 */
const META_ALIASES: Record<string, keyof MetaData> = {
  displayName: 'title',
};

/**
 * Improved parsing function that handles numbers, booleans, semicolons, and equals signs in values.
 * @param {string} envStr - The environment variable string to be parsed.
 */
export const parseAgentConfig = (envStr: string) => {
  const config: Record<string, unknown> = {};
  // use regex to match key-value pairs, considering the possibility of semicolons in values
  const regex = /([^;=]+)=("[^"]+"|[^;]+)/g;
  let match;

  while ((match = regex.exec(envStr)) !== null) {
    const key = match[1].trim();
    const value = match[2].trim();
    if (!key || !value) return;

    let finalValue: unknown = value;

    // Handle string value
    if (value.startsWith('"') && value.endsWith('"')) {
      finalValue = value.slice(1, -1);
    }
    // Handle numeric values
    else if (!Number.isNaN(Number(value))) {
      finalValue = Number(value);
    }
    // Handle boolean values
    else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
      finalValue = value.toLowerCase() === 'true';
    }
    // Handle arrays
    else if (value.includes(',') || value.includes('，')) {
      const array = value.replaceAll('，', ',').split(',');
      finalValue = array.map((item) => (Number.isNaN(Number(item)) ? item : Number(item)));
    }

    // handle plugins if it's a string
    if (key === 'plugins') {
      finalValue = typeof finalValue === 'string' ? [finalValue] : finalValue;
    }

    set(config, key, finalValue);
  }

  return config;
};

/**
 * Parse DEFAULT_AGENT_CONFIG env string and split the result into { config, meta }
 * so that meta keys (avatar, displayName, description, etc.) end up in the right bucket.
 */
/**
 * Replace alias keys (e.g. `displayName`) with their canonical meta key (`title`)
 * directly in the raw env string so that `parseAgentConfig`'s natural last-wins
 * behaviour applies correctly when both an alias and its canonical key appear.
 */
const normalizeAliases = (envStr: string): string => {
  const regex = /([^;=]+)(=[^;]*)/g;
  return envStr.replace(regex, (_match, rawKey: string, rest: string) => {
    const key = rawKey.trim();
    const canonical = META_ALIASES[key];
    return canonical ? canonical + rest : rawKey + rest;
  });
};

export const parseDefaultAgentSettings = (envStr: string) => {
  const flat = parseAgentConfig(normalizeAliases(envStr));
  if (!flat || Object.keys(flat).length === 0) return undefined;

  const config: Record<string, unknown> = {};
  const meta: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flat)) {
    if (META_KEYS.has(key)) {
      meta[key] = value;
    } else {
      config[key] = value;
    }
  }

  return {
    ...(Object.keys(config).length > 0 ? { config } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
};
