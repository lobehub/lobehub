// `{{config.KEY}}` is the form Market listings use (crawler-generated args, registry remote URLs);
// `{{KEY}}` is accepted too
const PLACEHOLDER = /\{\{\s*(?:config\.)?([\w.-]+)\s*\}\}/g;

const fillPlaceholders = (
  template: string,
  values: Record<string, unknown>,
  encode: (value: string) => string,
  usedKeys: string[] = [],
) =>
  template.replaceAll(PLACEHOLDER, (placeholder, key: string) => {
    const value = values[key];
    if (value === undefined || value === null || value === '') return placeholder;

    if (!usedKeys.includes(key)) usedKeys.push(key);
    return encode(String(value));
  });

/**
 * Fill config placeholders in an HTTP MCP URL with the user's config values,
 * for servers that read credentials from the URL (e.g. `?apikey={{config.API_KEY}}`)
 * rather than from headers. Values are URL-encoded. A placeholder without a
 * value is left as is.
 *
 * Returns the keys the URL used, so callers send only the rest as headers.
 */
export const renderMcpUrlTemplate = (url: string, values?: Record<string, unknown>) => {
  const usedKeys: string[] = [];
  if (!values) return { url, usedKeys };

  return { url: fillPlaceholders(url, values, encodeURIComponent, usedKeys), usedKeys };
};

/**
 * Fill config placeholders in stdio args (e.g. `API_KEY={{config.API_KEY}}`) with the
 * raw config values. The config is still passed as env too.
 */
export const renderMcpArgs = (args?: string[], values?: Record<string, unknown>) => {
  if (!args || !values) return args;

  return args.map((arg) => fillPlaceholders(arg, values, (value) => value));
};
