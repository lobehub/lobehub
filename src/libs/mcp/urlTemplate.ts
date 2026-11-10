const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Fill `{{KEY}}` placeholders in an HTTP MCP URL with the user's config values,
 * for servers that read credentials from the URL (e.g. `?apikey={{API_KEY}}`)
 * rather than from headers. Values are URL-encoded. A placeholder without a
 * value is left as is.
 *
 * Returns the keys the URL used, so callers send only the rest as headers.
 */
export const renderMcpUrlTemplate = (url: string, values?: Record<string, unknown>) => {
  const usedKeys: string[] = [];
  if (!values) return { url, usedKeys };

  const rendered = url.replaceAll(PLACEHOLDER, (placeholder, key: string) => {
    const value = values[key];
    if (value === undefined || value === null || value === '') return placeholder;

    if (!usedKeys.includes(key)) usedKeys.push(key);
    return encodeURIComponent(String(value));
  });

  return { url: rendered, usedKeys };
};
