/** Parses an Elasticsearch endpoint without allowing credentials to cross a plaintext network. */
export const parseElasticsearchUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Elasticsearch URL must be a valid absolute URL');
  }

  if (url.username || url.password) {
    throw new Error('Elasticsearch URL must not contain embedded credentials');
  }

  const isLoopback =
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost');
  /** Local development may use HTTP, but remote API keys must only cross an encrypted transport. */
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('Elasticsearch URL must use HTTPS unless it targets loopback');
  }

  return url;
};
