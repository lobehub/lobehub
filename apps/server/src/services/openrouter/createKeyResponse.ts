export interface OpenRouterKeyInfo {
  disabled: boolean;
  hash: string;
  limit: number | null;
  limitRemaining: number | null;
  name: string;
  usage: number;
}

export interface CreateOpenRouterKeyResult extends OpenRouterKeyInfo {
  /** Plaintext key — only available at creation time. Encrypt before persist. */
  key: string;
}

export const mapOpenRouterKeyInfo = (data: Record<string, unknown>): OpenRouterKeyInfo => ({
  disabled: Boolean(data.disabled),
  hash: String(data.hash),
  limit: data.limit == null ? null : Number(data.limit),
  limitRemaining: data.limit_remaining == null ? null : Number(data.limit_remaining),
  name: String(data.name ?? ''),
  usage: Number(data.usage ?? 0),
});

/**
 * Parse OpenRouter `POST /api/v1/keys` JSON.
 * The plaintext key is a top-level sibling of `data` (create only); older / mock
 * shapes may nest it under `data.key`.
 */
export const parseCreateKeyResponse = (
  json: Record<string, unknown>,
): CreateOpenRouterKeyResult => {
  const data = (json.data as Record<string, unknown> | undefined) ?? json;
  const key = String(json.key ?? data.key ?? '');
  if (!key) throw new Error('OpenRouter createKey response missing key');
  return { ...mapOpenRouterKeyInfo(data), key };
};
