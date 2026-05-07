import { getServerDBConfig } from '@/config/db';
import { type UserKeyVaults } from '@/types/user/settings';

interface DecryptionResult {
  plaintext: string;
  wasAuthentic: boolean;
}

interface KeyVaultSecretConfig {
  legacy?: string;
  primary: string;
}

const getConfiguredKeyVaultSecrets = () => {
  const { KEY_VAULTS_SECRET, LEGACY_KEY_VAULTS_SECRET } = getServerDBConfig();

  return [KEY_VAULTS_SECRET, LEGACY_KEY_VAULTS_SECRET].filter(
    (secret): secret is string => !!secret && secret.trim() !== '',
  );
};

const getKeyVaultSecretConfig = (): KeyVaultSecretConfig => {
  const { KEY_VAULTS_SECRET, LEGACY_KEY_VAULTS_SECRET } = getServerDBConfig();
  const legacySecret = LEGACY_KEY_VAULTS_SECRET?.trim() ? LEGACY_KEY_VAULTS_SECRET : undefined;

  if (!KEY_VAULTS_SECRET)
    throw new Error(` \`KEY_VAULTS_SECRET\` is not set, please set it in your environment variables.

If you don't have it, please run \`openssl rand -base64 32\` to create one.
`);

  if (legacySecret && legacySecret === KEY_VAULTS_SECRET) {
    throw new Error('`LEGACY_KEY_VAULTS_SECRET` must be different from `KEY_VAULTS_SECRET`.');
  }

  return legacySecret
    ? {
        legacy: legacySecret,
        primary: KEY_VAULTS_SECRET,
      }
    : { primary: KEY_VAULTS_SECRET };
};

const importAesKey = async (secret: string, label: string) => {
  const rawKey = Buffer.from(secret, 'base64');

  if (![16, 24, 32].includes(rawKey.length)) {
    throw new Error(
      `\`${label}\` must be 16, 24, or 32 bytes (128, 192, or 256 bits) when base64 decoded, got ${rawKey.length} bytes. ` +
        'Please run `openssl rand -base64 32` to create a valid key.',
    );
  }

  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

export const isKeyVaultsSecretBearerToken = (authorization: string | null) =>
  getConfiguredKeyVaultSecrets().some((secret) => authorization === `Bearer ${secret}`);

export class KeyVaultsGateKeeper {
  private legacyAesKey?: CryptoKey;
  private primaryAesKey: CryptoKey;

  constructor(primaryAesKey: CryptoKey, legacyAesKey?: CryptoKey) {
    this.primaryAesKey = primaryAesKey;
    this.legacyAesKey = legacyAesKey;
  }

  static initWithEnvKey = async () => {
    const { legacy, primary } = getKeyVaultSecretConfig();
    const primaryAesKey = await importAesKey(primary, 'KEY_VAULTS_SECRET');
    const legacyAesKey = legacy
      ? await importAesKey(legacy, 'LEGACY_KEY_VAULTS_SECRET')
      : undefined;

    return new KeyVaultsGateKeeper(primaryAesKey, legacyAesKey);
  };

  private decryptWithKey = async (encryptedData: string, aesKey: CryptoKey) => {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        iv,
        name: 'AES-GCM',
      },
      aesKey,
      Buffer.concat([encrypted, authTag]),
    );

    return new TextDecoder().decode(decryptedBuffer);
  };

  /**
   * encrypt user private data
   */
  encrypt = async (keyVault: string): Promise<string> => {
    const iv = crypto.getRandomValues(new Uint8Array(12)); // For GCM, 12-byte IV is recommended
    const encodedKeyVault = new TextEncoder().encode(keyVault);

    const encryptedData = await crypto.subtle.encrypt(
      {
        iv,
        name: 'AES-GCM',
      },
      this.primaryAesKey,
      encodedKeyVault,
    );

    const buffer = Buffer.from(encryptedData);
    const authTag = buffer.slice(-16); // Authentication tag is in the last 16 bytes of encrypted data
    const encrypted = buffer.slice(0, -16); // The rest is encrypted data

    return `${Buffer.from(iv).toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  };

  // Assuming key and encrypted data are obtained from external sources
  decrypt = async (encryptedData: string): Promise<DecryptionResult> => {
    if (encryptedData.split(':').length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    try {
      const decrypted = await this.decryptWithKey(encryptedData, this.primaryAesKey);
      return {
        plaintext: decrypted,
        wasAuthentic: true,
      };
    } catch {
      if (this.legacyAesKey) {
        try {
          const decrypted = await this.decryptWithKey(encryptedData, this.legacyAesKey);
          return {
            plaintext: decrypted,
            wasAuthentic: true,
          };
        } catch {
          // Fall through to unauthentic result when neither rotation key can decrypt.
        }
      }

      return {
        plaintext: '',
        wasAuthentic: false,
      };
    }
  };

  static getUserKeyVaults = async (
    encryptedKeyVaults: string | null,
    userId?: string,
  ): Promise<UserKeyVaults> => {
    if (!encryptedKeyVaults) return {};
    // Decrypt keyVaults
    let decryptKeyVaults = {};

    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const { wasAuthentic, plaintext } = await gateKeeper.decrypt(encryptedKeyVaults);

    if (wasAuthentic) {
      try {
        if (!!plaintext) decryptKeyVaults = JSON.parse(plaintext);
      } catch (e) {
        console.error(`Failed to parse keyVaults, userId: ${userId}. Error:`, e);
      }
    }

    return decryptKeyVaults as UserKeyVaults;
  };
}
