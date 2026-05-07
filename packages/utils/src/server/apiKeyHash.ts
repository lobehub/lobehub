import { createHmac } from 'node:crypto';

const getApiKeyHashSecret = () => process.env.KEY_VAULTS_SECRET;

const getLegacyApiKeyHashSecret = () => process.env.LEGACY_KEY_VAULTS_SECRET;

export const hashApiKeyWithSecret = (apiKey: string, secret: string): string =>
  createHmac('sha256', secret).update(apiKey).digest('hex');

export const hashApiKey = (apiKey: string): string => {
  const secret = getApiKeyHashSecret();

  if (!secret) {
    throw new Error('`KEY_VAULTS_SECRET` is required for API key hash calculation.');
  }

  return hashApiKeyWithSecret(apiKey, secret);
};

export const hashApiKeyWithLegacySecret = (apiKey: string): string | undefined => {
  const primarySecret = getApiKeyHashSecret();
  const legacySecret = getLegacyApiKeyHashSecret();

  if (!legacySecret || legacySecret.trim() === '' || legacySecret === primarySecret) return;

  return hashApiKeyWithSecret(apiKey, legacySecret);
};
