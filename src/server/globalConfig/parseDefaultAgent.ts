import { set } from 'es-toolkit/compat';

// Keys that belong in MetaData rather than LobeAgentConfig
const META_KEYS = new Set(['avatar', 'backgroundColor', 'description', 'title', 'tags']);

// User-friendly aliases mapped to their canonical MetaData key
const META_ALIASES: Record<string, string> = {
  displayName: 'title',
};

/**
 * Improved parsing function that handles numbers, booleans, semicolons, and equals signs in values.
 * @param {string} envStr - The environment variable string to be parsed.
 */
export const parseAgentConfig = (envStr: string) => {
  const config = {};
  // use regex to match key-value pairs, considering the possibility of semicolons in values
  const regex = /([^;=]+)=("[^"]+"|[^;]+)/g;
  let match;

  while ((match = regex.exec(envStr)) !== null) {
    const key = match[1].trim();
    const value = match[2].trim();
    if (!key || !value) return;

    let finalValue: any = value;

    // Handle string value
    if (value.startsWith('"') && value.endsWith('"')) {
      finalValue = value.slice(1, -1);
    }
    // Handle numeric values
    else if (!isNaN(value as any)) {
      finalValue = Number(value);
    }
    // Handle boolean values
    else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
      finalValue = value.toLowerCase() === 'true';
    }
    // Handle arrays
    else if (value.includes(',') || value.includes('，')) {
      const array = value.replaceAll('，', ',').split(',');
      finalValue = array.map((item) => (isNaN(item as any) ? item : Number(item)));
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
export const parseDefaultAgentSettings = (envStr: string) => {
  const flat = parseAgentConfig(envStr);
  if (!flat || Object.keys(flat).length === 0) return undefined;

  const config: Record<string, any> = {};
  const meta: Record<string, any> = {};

  for (const [key, value] of Object.entries(flat)) {
    const aliasedKey = META_ALIASES[key];
    if (aliasedKey) {
      meta[aliasedKey] = value;
    } else if (META_KEYS.has(key)) {
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
