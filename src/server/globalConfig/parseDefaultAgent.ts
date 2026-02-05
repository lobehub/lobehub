import { set } from 'es-toolkit/compat';

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
