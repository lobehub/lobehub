export interface ParseElasticsearchUrlOptions {
  /**
   * Permits plaintext HTTP to a non-loopback host. Intended only for an Elasticsearch node that is
   * reachable exclusively over a private container network (for example the optional Docker Compose
   * `elasticsearch` service). Enabling it never permits sending an API key over plaintext.
   */
  allowInsecureHttp?: boolean;
}

export interface ElasticsearchTransportInput extends ParseElasticsearchUrlOptions {
  apiKey?: string;
  url: string;
}

export interface ElasticsearchTransport {
  /** `ApiKey <key>` when the endpoint is authenticated; undefined for explicit no-auth deployments. */
  authorizationHeader: string | undefined;
  url: URL;
}

const isLoopbackHostname = (hostname: string) =>
  hostname === '127.0.0.1' ||
  hostname === '[::1]' ||
  hostname === 'localhost' ||
  hostname.endsWith('.localhost');

/** Parses an Elasticsearch endpoint without allowing credentials to cross a plaintext network. */
export const parseElasticsearchUrl = (
  value: string,
  { allowInsecureHttp = false }: ParseElasticsearchUrlOptions = {},
): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Elasticsearch URL must be a valid absolute URL');
  }

  if (url.username || url.password) {
    throw new Error('Elasticsearch URL must not contain embedded credentials');
  }

  const isPlaintextHttp = url.protocol === 'http:';
  /**
   * Local development may use HTTP, but remote API keys must only cross an encrypted transport.
   * A non-loopback HTTP endpoint is accepted only by explicit operator opt-in.
   */
  const allowedPlaintext =
    isPlaintextHttp && (isLoopbackHostname(url.hostname) || allowInsecureHttp);
  if (url.protocol !== 'https:' && !allowedPlaintext) {
    throw new Error('Elasticsearch URL must use HTTPS unless it targets loopback');
  }

  return url;
};

/**
 * Resolves the endpoint and Authorization header shared by every Elasticsearch HTTP client so the
 * runtime, reindex, and sync paths enforce one security boundary:
 *
 * - an API key is required unless `allowInsecureHttp` was explicitly enabled;
 * - an API key is never sent to a non-loopback host over plaintext HTTP, even when insecure HTTP
 *   is allowed.
 */
export const resolveElasticsearchTransport = ({
  allowInsecureHttp = false,
  apiKey,
  url: value,
}: ElasticsearchTransportInput): ElasticsearchTransport => {
  const url = parseElasticsearchUrl(value, { allowInsecureHttp });

  if (!apiKey) {
    if (!allowInsecureHttp) {
      throw new Error('Elasticsearch API key is required unless ES_ALLOW_INSECURE_HTTP=true');
    }
    return { authorizationHeader: undefined, url };
  }

  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new Error(
      'Elasticsearch API key must not be sent over plaintext HTTP; use HTTPS or remove ES_API_KEY',
    );
  }

  return { authorizationHeader: `ApiKey ${apiKey}`, url };
};
