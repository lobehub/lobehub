import { getServerDBConfig } from '@/config/db';
import { type UserKeyVaults } from '@/types/user/settings';

interface DecryptionResult {
  plaintext: string;
  wasAuthentic: boolean;
}

const importAesKey = async (secret: string, envName: string) => {
  const rawKey = Buffer.from(secret, 'base64');

  // AES-GCM supports 128, 192, and 256 bit keys.
  // See: https://developer.mozilla.org/en-US/docs/Web/API/AesKeyGenParams#length
  if (![16, 24, 32].includes(rawKey.length)) {
    throw new Error(
      `\`${envName}\` must be 16, 24, or 32 bytes (128, 192, or 256 bits) when base64 decoded, got ${rawKey.length} bytes. ` +
        'Please run `openssl rand -base64 32` to create a valid key.',
    );
  }

  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

export const getKeyVaultsSecrets = () => {
  const { KEY_VAULTS_FALLBACK_SECRET, KEY_VAULTS_SECRET } = getServerDBConfig();
  const active = KEY_VAULTS_SECRET?.trim() ? KEY_VAULTS_SECRET : undefined;
  const fallback =
    active && KEY_VAULTS_FALLBACK_SECRET?.trim() ? KEY_VAULTS_FALLBACK_SECRET : undefined;

  return {
    active,
    fallback: fallback === active ? undefined : fallback,
  };
};

export const isKeyVaultsSecretBearerToken = (authorization: string | null) => {
  const { active, fallback } = getKeyVaultsSecrets();
  if (!active) return false;

  return [active, fallback].some(
    (secret) => secret !== undefined && authorization === `Bearer ${secret}`,
  );
};

export class KeyVaultsGateKeeper {
  private activeAesKey: CryptoKey;
  private fallbackAesKey?: CryptoKey;

  constructor(activeAesKey: CryptoKey, fallbackAesKey?: CryptoKey) {
    this.activeAesKey = activeAesKey;
    this.fallbackAesKey = fallbackAesKey;
  }

  static initWithEnvKey = async () => {
    const { active, fallback } = getKeyVaultsSecrets();
    if (!active)
      throw new Error(` \`KEY_VAULTS_SECRET\` is not set, please set it in your environment variables.

If you don't have it, please run \`openssl rand -base64 32\` to create one.
`);

    const activeAesKey = await importAesKey(active, 'KEY_VAULTS_SECRET');
    const fallbackAesKey = fallback
      ? await importAesKey(fallback, 'KEY_VAULTS_FALLBACK_SECRET')
      : undefined;

    return new KeyVaultsGateKeeper(activeAesKey, fallbackAesKey);
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
      this.activeAesKey,
      encodedKeyVault,
    );

    const buffer = Buffer.from(encryptedData);
    const authTag = buffer.slice(-16); // Authentication tag is in the last 16 bytes of encrypted data
    const encrypted = buffer.slice(0, -16); // The rest is encrypted data

    return `${Buffer.from(iv).toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  };

  private decryptWithKey = async (encryptedData: string, aesKey: CryptoKey) => {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');

    // Combine encrypted data and authentication tag
    const combined = Buffer.concat([encrypted, authTag]);

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        iv,
        name: 'AES-GCM',
      },
      aesKey,
      combined,
    );

    return new TextDecoder().decode(decryptedBuffer);
  };

  // Assuming key and encrypted data are obtained from external sources
  decrypt = async (encryptedData: string): Promise<DecryptionResult> => {
    if (encryptedData.split(':').length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    try {
      const plaintext = await this.decryptWithKey(encryptedData, this.activeAesKey);
      return {
        plaintext,
        wasAuthentic: true,
      };
    } catch {
      if (this.fallbackAesKey) {
        try {
          const plaintext = await this.decryptWithKey(encryptedData, this.fallbackAesKey);
          return {
            plaintext,
            wasAuthentic: true,
          };
        } catch {
          // Return the existing unauthentic result after both configured keys fail.
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
