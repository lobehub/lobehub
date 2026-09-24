import type {
  HandleCreateVideoWebhookPayload,
  HandleCreateVideoWebhookResult,
} from '../../types/video';

const GOOGLE_WEBHOOK_JWKS_URL = 'https://generativelanguage.googleapis.com/.well-known/jwks.json';
const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

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

async function verifyDynamicWebhook(payload: HandleCreateVideoWebhookPayload) {
  const signature = getHeader(payload.headers, 'webhook-signature');
  if (!signature) throw new Error('Missing Google webhook signature');

  const timestamp = getHeader(payload.headers, 'webhook-timestamp');
  if (!timestamp) throw new Error('Missing Google webhook timestamp');

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_WEBHOOK_AGE_MS) {
    throw new Error('Google webhook timestamp is outside the allowed replay window');
  }

  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const jwks = createRemoteJWKSet(new URL(GOOGLE_WEBHOOK_JWKS_URL));

  await jwtVerify(signature, jwks, {
    algorithms: ['RS256'],
  });
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
