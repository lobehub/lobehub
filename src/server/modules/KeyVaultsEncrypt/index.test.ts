// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyVaultsGateKeeper } from './index';

describe('KeyVaultsGateKeeper', () => {
  let gateKeeper: KeyVaultsGateKeeper;
  let originalSecret: string | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    originalSecret = process.env.KEY_VAULTS_SECRET;
    process.env.KEY_VAULTS_SECRET = 'Q10pwdq00KXUu9R+c8A8p4PSlIRWi7KwgUophBtkHVk=';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  });

  afterEach(() => {
    process.env.KEY_VAULTS_SECRET = originalSecret;
    consoleErrorSpy.mockRestore();
  });

  it('should encrypt and decrypt data correctly', async () => {
    const originalData = 'sensitive user data';
    const encryptedData = await gateKeeper.encrypt(originalData);
    const decryptionResult = await gateKeeper.decrypt(encryptedData);

    expect(decryptionResult.plaintext).toBe(originalData);
    expect(decryptionResult.wasAuthentic).toBe(true);
  });

  it('should return empty plaintext and false authenticity for invalid encrypted data', async () => {
    const invalidEncryptedData = 'invalid:encrypted:data';
    const decryptionResult = await gateKeeper.decrypt(invalidEncryptedData);

    expect(decryptionResult.plaintext).toBe('');
    expect(decryptionResult.wasAuthentic).toBe(false);
  });

  it('should throw an error if KEY_VAULTS_SECRET is not set', async () => {
    process.env.KEY_VAULTS_SECRET = '';

    await expect(KeyVaultsGateKeeper.initWithEnvKey()).rejects.toEqual(
      new Error(` \`KEY_VAULTS_SECRET\` is not set, please set it in your environment variables.

If you don't have it, please run \`openssl rand -base64 32\` to create one.
`),
    );
  });

  it('should throw an error if KEY_VAULTS_SECRET decodes to an unsupported length', async () => {
    process.env.KEY_VAULTS_SECRET = Buffer.from('short').toString('base64');

    await expect(KeyVaultsGateKeeper.initWithEnvKey()).rejects.toThrow(
      '`KEY_VAULTS_SECRET` must be 16, 24, or 32 bytes',
    );
  });

  it('should throw an error for invalid encrypted data format', async () => {
    await expect(gateKeeper.decrypt('invalid-format')).rejects.toThrow(
      'Invalid encrypted data format',
    );
  });

  describe('getUserKeyVaults', () => {
    it('should return an empty object when encrypted key vaults are missing', async () => {
      await expect(KeyVaultsGateKeeper.getUserKeyVaults(null)).resolves.toEqual({});
    });

    it('should decrypt and parse valid key vaults json', async () => {
      const encrypted = await gateKeeper.encrypt(JSON.stringify({ openai: 'sk-test' }));

      await expect(KeyVaultsGateKeeper.getUserKeyVaults(encrypted)).resolves.toEqual({
        openai: 'sk-test',
      });
    });

    it('should return an empty object when decrypted plaintext is empty', async () => {
      const encrypted = await gateKeeper.encrypt('');

      await expect(KeyVaultsGateKeeper.getUserKeyVaults(encrypted)).resolves.toEqual({});
    });

    it('should return an empty object when ciphertext is not authentic', async () => {
      const encrypted = await gateKeeper.encrypt(JSON.stringify({ openai: 'sk-test' }));
      process.env.KEY_VAULTS_SECRET = 'ofQiJCXLF8mYemwfMWLOHoHimlPu91YmLfU7YZ4lreQ=';

      await expect(KeyVaultsGateKeeper.getUserKeyVaults(encrypted)).resolves.toEqual({});
    });

    it('should log parse errors and return an empty object for non-json plaintext', async () => {
      const encrypted = await gateKeeper.encrypt('not-json');

      await expect(KeyVaultsGateKeeper.getUserKeyVaults(encrypted, 'user-1')).resolves.toEqual({});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to parse keyVaults, userId: user-1. Error:',
        expect.any(SyntaxError),
      );
    });
  });
});
