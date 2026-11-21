import { createHmac } from 'node:crypto';

const getApiKeyHashSecret = () => process.env.KEY_VAULTS_SECRET;

const getApiKeyHashFallbackSecret = () => process.env.KEY_VAULTS_FALLBACK_SECRET;

export const hashApiKeyWithSecret = (apiKey: string, secret: string): string =>
  createHmac('sha256', secret).update(apiKey).digest('hex');

export const hashApiKey = (apiKey: string): string => {
  const secret = getApiKeyHashSecret();

  if (!secret) {
    throw new Error('`KEY_VAULTS_SECRET` is required for API key hash calculation.');
  }

  return hashApiKeyWithSecret(apiKey, secret);
};

export const getApiKeyHashes = (apiKey: string): string[] => {
  const activeSecret = getApiKeyHashSecret();
  if (!activeSecret) {
    throw new Error('`KEY_VAULTS_SECRET` is required for API key hash calculation.');
  }

  const fallbackSecret = getApiKeyHashFallbackSecret();
  const secrets =
    fallbackSecret?.trim() && fallbackSecret !== activeSecret
      ? [activeSecret, fallbackSecret]
      : [activeSecret];

  return secrets.map((secret) => hashApiKeyWithSecret(apiKey, secret));
};
