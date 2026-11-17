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

export const openWebhookSecret = async (ciphertext: string) => {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const { plaintext } = await gateKeeper.decrypt(ciphertext);
  return plaintext;
};
