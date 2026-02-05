// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { KeyVaultsGateKeeper } from './index';

describe('KeyVaultsGateKeeper', () => {
  let gateKeeper: KeyVaultsGateKeeper;

  beforeEach(async () => {
    process.env.KEY_VAULTS_SECRET = 'Q10pwdq00KXUu9R+c8A8p4PSlIRWi7KwgUophBtkHVk=';
    // 在每个测试用例运行前初始化 KeyVaultsGateKeeper 实例
    gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  });

  it('should encrypt and decrypt data correctly', async () => {
    const originalData = 'sensitive user data';

    // 加密数据
    const encryptedData = await gateKeeper.encrypt(originalData);

    // 解密数据
    const decryptionResult = await gateKeeper.decrypt(encryptedData);

    // 断言解密后的明文与原始数据相同
    expect(decryptionResult.plaintext).toBe(originalData);
    // 断言解密是真实的(通过认证)
    expect(decryptionResult.wasAuthentic).toBe(true);
  });

  it('should return empty plaintext and false authenticity for invalid encrypted data', async () => {
    const invalidEncryptedData = 'invalid:encrypted:data';

    // 尝试解密无效的加密数据
    const decryptionResult = await gateKeeper.decrypt(invalidEncryptedData);

    // 断言解密后的明文为空字符串
    expect(decryptionResult.plaintext).toBe('');
    // 断言解密是不真实的(未通过认证)
    expect(decryptionResult.wasAuthentic).toBe(false);
  });

  it('should throw an error if KEY_VAULTS_SECRET is not set', async () => {
    // 将 KEY_VAULTS_SECRET 设为 undefined
    const originalSecretKey = process.env.KEY_VAULTS_SECRET;
    process.env.KEY_VAULTS_SECRET = '';

    // 断言在 KEY_VAULTS_SECRET 未设置时会抛出错误
    try {
      await KeyVaultsGateKeeper.initWithEnvKey();
    } catch (e) {
      expect(e).toEqual(
        new Error(` \`KEY_VAULTS_SECRET\` is not set, please set it in your environment variables.

If you don't have it, please run \`openssl rand -base64 32\` to create one.
`),
      );
    }

    // 恢复 KEY_VAULTS_SECRET 的原始值
    process.env.KEY_VAULTS_SECRET = originalSecretKey;
  });
});
