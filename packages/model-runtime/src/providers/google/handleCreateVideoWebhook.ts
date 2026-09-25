import type {
  HandleCreateVideoWebhookPayload,
  HandleCreateVideoWebhookResult,
} from '../../types/video';

const GOOGLE_WEBHOOK_JWKS_URL = 'https://generativelanguage.googleapis.com/.well-known/jwks.json';
const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

interface GoogleWebhookJwk extends JsonWebKey {
  alg?: string;
  crv?: string;
}

let jwksCache: { expiresAt: number; keys: CryptoKey[] } | undefined;

const importEd25519Keys = async (keys: GoogleWebhookJwk[]) => {
  const imported: CryptoKey[] = [];

  for (const jwk of keys) {
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') continue;

    imported.push(
      await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']),
    );
  }

  return imported;
};

const getGoogleWebhookKeys = async (forceRefresh = false) => {
  if (!forceRefresh && jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;

  const res = await fetch(GOOGLE_WEBHOOK_JWKS_URL);
  if (!res.ok) throw new Error(`Failed to fetch Google webhook keys: ${res.status}`);

  const { keys = [] } = (await res.json()) as { keys?: GoogleWebhookJwk[] };
  const imported = await importEd25519Keys(keys);
  jwksCache = { expiresAt: Date.now() + JWKS_CACHE_TTL_MS, keys: imported };

  return imported;
};

const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const verifyWithKeys = async (
  keys: CryptoKey[],
  signatures: Uint8Array<ArrayBuffer>[],
  content: Uint8Array<ArrayBuffer>,
) => {
  for (const signature of signatures) {
    for (const key of keys) {
      if (await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, content)) return true;
    }
  }

  return false;
};

interface GoogleWebhookBody {
  data?: {
    error_code?: string;
    error_message?: string;
    id?: string;
  };
  type?: string;
}

const getHeader = (headers: Record<string, string> | undefined, name: string) => {
  if (!headers) return undefined;

  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  return entry?.[1];
};

/**
 * Verifies a dynamic (per-request `webhook_config`) delivery.
 *
 * Although the Gemini docs describe the header as an RS256 JWT, real deliveries follow the
 * Standard Webhooks asymmetric scheme: `webhook-signature: v1a,<base64 Ed25519 signature>`
 * over `${webhook-id}.${webhook-timestamp}.${rawBody}`, verified against the Ed25519 keys
 * published at the JWKS endpoint (which carry no `kid`). Observed on 2026-09-25.
 * @see https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 */
async function verifyDynamicWebhook(payload: HandleCreateVideoWebhookPayload) {
  const signatureHeader = getHeader(payload.headers, 'webhook-signature');
  if (!signatureHeader) throw new Error('Missing Google webhook signature');

  const webhookId = getHeader(payload.headers, 'webhook-id');
  if (!webhookId) throw new Error('Missing Google webhook id');

  if (payload.rawBody === undefined) throw new Error('Missing raw body for Google webhook');

  const timestamp = getHeader(payload.headers, 'webhook-timestamp');
  if (!timestamp) throw new Error('Missing Google webhook timestamp');

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_WEBHOOK_AGE_MS) {
    throw new Error('Google webhook timestamp is outside the allowed replay window');
  }

  // The header may carry several space-separated `<version>,<signature>` entries during key rotation.
  const signatures = signatureHeader
    .split(' ')
    .map((entry) => entry.split(','))
    .filter(([version, value]) => version === 'v1a' && value)
    .map(([, value]) => decodeBase64(value));
  if (signatures.length === 0) throw new Error('Unsupported Google webhook signature format');

  const content = new TextEncoder().encode(`${webhookId}.${timestamp}.${payload.rawBody}`);

  if (await verifyWithKeys(await getGoogleWebhookKeys(), signatures, content)) return;
  // Retry once with fresh keys in case Google rotated them after we cached the set.
  if (await verifyWithKeys(await getGoogleWebhookKeys(true), signatures, content)) return;

  throw new Error('Invalid Google webhook signature');
}

export async function handleGoogleVideoWebhook(
  payload: HandleCreateVideoWebhookPayload,
): Promise<HandleCreateVideoWebhookResult> {
  await verifyDynamicWebhook(payload);

  const body = payload.body as GoogleWebhookBody;
  const inferenceId = body.data?.id;

  if (!inferenceId) throw new Error('Missing interaction id in Google webhook body');

  switch (body.type) {
    case 'interaction.completed':
    case 'video.generated': {
      return { inferenceId, status: 'completed' };
    }

    case 'interaction.failed':
    case 'interaction.cancelled': {
      return {
        error:
          body.data?.error_message ||
          body.data?.error_code ||
          `Gemini interaction ${body.type.split('.')[1]}`,
        inferenceId,
        status: 'error',
      };
    }

    default: {
      return { inferenceId, status: 'pending' };
    }
  }
}
