const LOCAL_S3_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const LOCAL_NO_PROXY_HOSTS = ['localhost', '127.0.0.1', '::1'] as const;

/** True when the S3 endpoint is loopback and must not go through HTTP_PROXY/Clash. */
export const isLocalS3Endpoint = (endpoint: string): boolean => {
  try {
    return LOCAL_S3_HOSTS.has(new URL(endpoint).hostname);
  } catch {
    return false;
  }
};

/**
 * Server-side AWS SDK endpoint. In Docker, `S3_ENDPOINT=http://localhost:9000`
 * is the app container itself (ECONNREFUSED); compose sets `S3_INTERNAL_ENDPOINT`
 * to `http://rustfs:9000`. Presigned URLs keep using the public `S3_ENDPOINT`.
 */
export const resolveS3SdkEndpoint = (
  endpoint: string | undefined,
  internalEndpoint?: string,
): string | undefined => {
  if (internalEndpoint) return internalEndpoint;
  return endpoint;
};

/** Ensure AWS SDK / Node honor NO_PROXY for loopback even when Clash sets HTTP_PROXY. */
export const ensureLocalNoProxyEnv = () => {
  const existing = process.env.NO_PROXY || process.env.no_proxy || '';
  const entries = new Set(
    existing
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  if (entries.has('*')) return;

  for (const host of LOCAL_NO_PROXY_HOSTS) {
    entries.add(host);
  }

  const merged = [...entries].join(',');
  process.env.NO_PROXY = merged;
  process.env.no_proxy = merged;
};
