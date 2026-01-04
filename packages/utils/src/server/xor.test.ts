import { describe, expect, it } from 'vitest';

import { obfuscatePayloadWithXOR } from '../client/xor-obfuscation';
import { getXorPayload } from './xor';

describe('getXorPayload', () => {
  it('should correctly decode XOR obfuscated payload with user data', () => {
    const originalPayload = {
      userId: '001362c3-48c5-4635-bd3b-837bfff58fc0',
      apiKey: 'test-api-key',
      baseURL: 'https://api.example.com',
    };

    // 使用客户端的混淆函数生成token
    const obfuscatedToken = obfuscatePayloadWithXOR(originalPayload);

    // 使用服务端的解码函数解码
    const decodedPayload = getXorPayload(obfuscatedToken);

    expect(decodedPayload).toEqual(originalPayload);
  });

  it('should correctly decode XOR obfuscated payload with minimal data', () => {
    const originalPayload = {
      userId: '12345',
    };

    const obfuscatedToken = obfuscatePayloadWithXOR(originalPayload);
    const decodedPayload = getXorPayload(obfuscatedToken);

    expect(decodedPayload).toEqual(originalPayload);
  });

  it('should correctly decode XOR obfuscated payload with AWS credentials', () => {
    const originalPayload = {
      userId: 'aws-user-123',
      awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      awsSecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      awsRegion: 'us-east-1',
      awsSessionToken: 'session-token-example',
    };

    const obfuscatedToken = obfuscatePayloadWithXOR(originalPayload);
    const decodedPayload = getXorPayload(obfuscatedToken);

    expect(decodedPayload).toEqual(originalPayload);
  });

  it('should correctly decode XOR obfuscated payload with Azure data', () => {
    const originalPayload = {
      userId: 'azure-user-456',
      apiKey: 'azure-api-key',
      baseURL: 'https://your-resource.openai.azure.com',
      azureApiVersion: '2024-02-15-preview',
    };

    const obfuscatedToken = obfuscatePayloadWithXOR(originalPayload);
    const decodedPayload = getXorPayload(obfuscatedToken);

    expect(decodedPayload).toEqual(originalPayload);
  });

  it('should correctly decode XOR obfuscated payload with Cloudflare data', () => {
    const originalPayload = {
      userId: 'cf-user-789',
      apiKey: 'cloudflare-api-key',
      cloudflareBaseURLOrAccountID: 'account-id-example',
    };

    const obfuscatedToken = obfuscatePayloadWithXOR(originalPayload);
    const decodedPayload = getXorPayload(obfuscatedToken);

    expect(decodedPayload).toEqual(originalPayload);
  });

  it('should handle empty payload correctly', () => {
    const originalPayload = {};

    const obfuscatedToken = obfuscatePayloadWithXOR(originalPayload);
    const decodedPayload = getXorPayload(obfuscatedToken);

    expect(decodedPayload).toEqual(originalPayload);
  });

  it('should handle payload with undefined values', () => {
    const originalPayload = {
      userId: 'test-user',
      baseURL: undefined,
      apiKey: 'test-key',
    };

    const obfuscatedToken = obfuscatePayloadWithXOR(originalPayload);
    const decodedPayload = getXorPayload(obfuscatedToken);

    expect(decodedPayload).toEqual(originalPayload);
  });

  it('should throw error for invalid base64 token', () => {
    const invalidToken = 'invalid-base64-token!@#';

    expect(() => getXorPayload(invalidToken)).toThrow(SyntaxError);
  });

  it('should throw error for token that cannot be parsed as JSON', () => {
    // 创建一个能正确base64解码但不是有效JSON的token
    const invalidJsonString = 'this is not json';
    const invalidJsonBytes = new TextEncoder().encode(invalidJsonString);
    const keyBytes = new TextEncoder().encode('LobeHub · LobeHub');

    // 进行XOR处理
    const result = new Uint8Array(invalidJsonBytes.length);
    for (const [i, datum] of invalidJsonBytes.entries()) {
      result[i] = datum ^ keyBytes[i % keyBytes.length];
    }

    // 转换为base64
    const invalidToken = Buffer.from(result).toString('base64');

    expect(() => getXorPayload(invalidToken)).toThrow(SyntaxError);
  });
});
