export const REDACTED = '[redacted]';

/** Secret values carried by agent-credential params, for scrubbing text. */
const secretValues = (params: unknown): string[] => {
  const secret = (params as { secret?: Record<string, unknown> } | null)?.secret;
  if (!secret || typeof secret !== 'object') return [];
  const values = [secret.token, secret.authJson].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  // Codex auth.json embeds tokens; scrub each one on its own too.
  if (typeof secret.authJson === 'string') {
    try {
      const collect = (node: unknown) => {
        if (typeof node === 'string' && node.length >= 8) values.push(node);
        else if (node && typeof node === 'object') Object.values(node).forEach(collect);
      };
      collect(JSON.parse(secret.authJson));
    } catch {
      // Unparseable input: the whole string is already listed.
    }
  }
  // Longest first, so a token inside the auth.json is not half-replaced.
  return values.sort((a, b) => b.length - a.length);
};

/**
 * A copy of agent-credential RPC params that is safe for logs and debug
 * output: the provider and secret type stay, every secret field is replaced.
 */
export const redactAgentCredentialParams = (params: unknown): unknown => {
  if (!params || typeof params !== 'object') return params;
  const { secret, ...rest } = params as { secret?: unknown };
  if (secret === undefined) return rest;
  if (!secret || typeof secret !== 'object') return { ...rest, secret: REDACTED };
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(secret)) {
    redacted[key] = key === 'type' || key === 'expiresAt' ? value : REDACTED;
  }
  return { ...rest, secret: redacted };
};

/** Replace every secret value from `params` (and any extra secrets) found in `text`. */
export const scrubAgentCredentialText = (
  text: string,
  params: unknown,
  extraSecrets: string[] = [],
): string => {
  let scrubbed = text;
  for (const value of [...secretValues(params), ...extraSecrets]) {
    if (value) scrubbed = scrubbed.split(value).join(REDACTED);
  }
  return scrubbed;
};

/**
 * Rethrow an agent-credential failure without any secret in its message, so
 * the RPC error that travels back over the gateway (and lands in device and
 * server logs) never carries it.
 */
export const toRedactedAgentCredentialError = (error: unknown, params: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(scrubAgentCredentialText(message, params));
};
