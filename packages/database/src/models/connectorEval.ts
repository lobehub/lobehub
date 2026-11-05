import type {
  ConnectorCredentials,
  ConnectorMetadata,
  NewUserConnector,
  UserConnectorItem,
} from '../schemas';

type ConnectorPatch = Partial<Omit<NewUserConnector, 'userId' | 'id' | 'createdAt' | 'updatedAt'>>;

export class EvalConnectorUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalConnectorUpdateError';
  }
}

/** Import provenance is server-owned; ordinary connector requests cannot create it. */
export const withoutEvalConnectorMarker = (
  metadata: ConnectorMetadata | null | undefined,
): ConnectorMetadata | null | undefined => {
  if (!metadata) return metadata;
  const { agentEval: _agentEval, ...rest } = metadata;
  return rest;
};

const validatedHeaders = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EvalConnectorUpdateError('Invalid mock connection headers');
  }
  const entries = Object.entries(value);
  if (
    entries.some(
      ([key, entry]) =>
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) ||
        typeof entry !== 'string' ||
        /[\r\n]/.test(entry),
    )
  )
    throw new EvalConnectorUpdateError('Invalid mock connection headers');
  return Object.fromEntries(entries);
};

const parseCredentials = (plaintext: string): ConnectorCredentials => {
  try {
    const value = JSON.parse(plaintext) as ConnectorCredentials;
    if (value?.type === 'header')
      return { headers: validatedHeaders(value.headers), type: 'header' };
    if (value?.type === 'bearer' && typeof value.token === 'string' && !/[\r\n]/.test(value.token))
      return value;
    if (
      value?.type === 'apikey' &&
      typeof value.apiKey === 'string' &&
      !/[\r\n]/.test(value.apiKey)
    )
      return value;
    if (value?.type === 'oauth2' && typeof value.accessToken === 'string') return value;
  } catch {
    // Never expose a JSON parse error that could contain a credential value.
  }
  throw new EvalConnectorUpdateError('Invalid mock connection credentials');
};

/** Normalize imported mock edits before encryption; never put their headers in metadata. */
export const normalizeEvalConnectorPatch = async (
  current: Pick<UserConnectorItem, 'credentials' | 'metadata' | 'mcpServerUrl'>,
  patch: ConnectorPatch,
  decrypt?: (ciphertext: string) => Promise<{ plaintext: string }>,
): Promise<ConnectorPatch> => {
  const marker = current.metadata?.agentEval;
  if (!marker)
    return {
      ...patch,
      ...(patch.metadata === undefined
        ? {}
        : { metadata: withoutEvalConnectorMarker(patch.metadata) }),
    };

  if (patch.agentId || patch.metadata?.mountedByAgentId) {
    throw new EvalConnectorUpdateError(
      'Evaluation connections cannot be assigned to a normal Agent.',
    );
  }
  const result = { ...patch };
  if (patch.mcpServerUrl != null) {
    let safeUrl = false;
    try {
      const url = new URL(patch.mcpServerUrl);
      safeUrl =
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash;
    } catch {
      // Keep addresses that could contain credentials out of error text.
    }
    if (!safeUrl)
      throw new EvalConnectorUpdateError(
        'Use an HTTP MCP address without embedded credentials, query or fragment',
      );
  }
  const headersSubmitted = Object.hasOwn(patch.metadata ?? {}, 'customHeaders');
  const storedHeaders = current.metadata?.customHeaders;
  const migrateHeaders =
    !headersSubmitted && storedHeaders !== undefined && patch.credentials === undefined;
  const headers = headersSubmitted
    ? validatedHeaders(patch.metadata?.customHeaders ?? {})
    : migrateHeaders
      ? validatedHeaders(storedHeaders)
      : undefined;
  if (patch.metadata !== undefined || storedHeaders !== undefined) {
    const { customHeaders: _headers, ...metadata } =
      patch.metadata !== undefined ? (patch.metadata ?? {}) : (current.metadata ?? {});
    result.metadata = { ...metadata, agentEval: marker };
  }
  const urlChanged =
    patch.mcpServerUrl !== undefined && patch.mcpServerUrl !== current.mcpServerUrl;
  if (
    urlChanged &&
    patch.credentials === undefined &&
    (current.credentials || Object.keys(headers ?? {}).length)
  ) {
    throw new EvalConnectorUpdateError(
      'Clear or replace authentication when changing a mock connection address',
    );
  }
  // The existing editor resends its header form while explicitly clearing auth on a URL edit.
  // Treat that clear as authoritative so old header tokens cannot follow the new address.
  if (urlChanged && patch.credentials === null) {
    return { ...result, credentials: null, status: 'disconnected', tokenExpiresAt: null };
  }

  let credentials: ConnectorCredentials | null | undefined;
  if (patch.credentials !== undefined) {
    credentials = patch.credentials === null ? null : parseCredentials(patch.credentials);
  } else if (headers !== undefined && current.credentials) {
    if (!decrypt) throw new EvalConnectorUpdateError('Secure connection storage is unavailable');
    try {
      credentials = parseCredentials((await decrypt(current.credentials)).plaintext);
    } catch {
      throw new EvalConnectorUpdateError('Could not securely read the mock connection');
    }
  }
  if (headers !== undefined) {
    if (credentials?.type === 'oauth2') {
      if (Object.keys(headers).length)
        throw new EvalConnectorUpdateError(
          'Use OAuth authentication without custom headers for this mock connection',
        );
    } else if (credentials?.type === 'bearer' || credentials?.type === 'apikey') {
      if (Object.keys(headers).length) {
        const token = credentials.type === 'bearer' ? credentials.token : credentials.apiKey;
        // A separate bearer credential is authoritative over a case-insensitive Authorization header.
        credentials = {
          headers: {
            ...Object.fromEntries(
              Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'authorization'),
            ),
            Authorization: `Bearer ${token}`,
          },
          type: 'header',
        };
      }
    } else {
      // Header edits replace the complete header set; {} clears it.
      const combined =
        credentials?.type === 'header' && patch.credentials !== undefined
          ? { ...credentials.headers, ...headers }
          : headers;
      credentials = Object.keys(combined).length ? { headers: combined, type: 'header' } : null;
    }
  }
  if (credentials !== undefined) {
    result.credentials = credentials === null ? null : JSON.stringify(credentials);
    result.status = 'disconnected';
    if (credentials?.type !== 'oauth2') result.tokenExpiresAt = null;
  } else if (urlChanged) result.status = 'disconnected';
  return result;
};
