import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { generateWebhookSecret, webhookSecretHint } from './signature';

/** A fresh secret, its ciphertext for the row, and the hint shown afterwards. */
export const createSealedWebhookSecret = async () => {
  const plaintext = generateWebhookSecret();
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  return {
    ciphertext: await gateKeeper.encrypt(plaintext),
    hint: webhookSecretHint(plaintext),
    plaintext,
  };
};

/** The stored secret cannot be decrypted, e.g. `KEY_VAULTS_SECRET` changed without a fallback. */
export class WebhookSecretUnavailableError extends Error {
  constructor() {
    super('The signing secret cannot be decrypted; rotate the secret');
    this.name = 'WebhookSecretUnavailableError';
  }
}

export const openWebhookSecret = async (ciphertext: string) => {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const { plaintext, wasAuthentic } = await gateKeeper.decrypt(ciphertext);
  // A failed decryption yields '' — signing with it would look like a receiver-side mismatch.
  if (!wasAuthentic || !plaintext) throw new WebhookSecretUnavailableError();
  return plaintext;
};
