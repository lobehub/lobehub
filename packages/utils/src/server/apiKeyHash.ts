import { createHmac } from 'node:crypto';

const getApiKeyHashSecret = () => process.env.KEY_VAULTS_SECRET;

export const hashApiKey = (apiKey: string): string => {
  const secret = getApiKeyHashSecret();

  if (!secret) {
    throw new Error('`KEY_VAULTS_SECRET` is required for API key hash calculation.');
  }

  return createHmac('sha256', secret).update(apiKey).digest('hex');
};
