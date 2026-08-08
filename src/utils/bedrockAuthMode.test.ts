import { describe, expect, it } from 'vitest';

import {
  BedrockAuthMode,
  inferBedrockAuthMode,
  normalizeBedrockConfigValues,
  normalizeBedrockKeyVaultsForAuthMode,
} from './bedrockAuthMode';

describe('Bedrock auth mode helpers', () => {
  describe('inferBedrockAuthMode', () => {
    it('should default to API key mode when keyVaults are empty', () => {
      expect(inferBedrockAuthMode()).toBe(BedrockAuthMode.ApiKey);
      expect(inferBedrockAuthMode({})).toBe(BedrockAuthMode.ApiKey);
    });

    it('should use API key mode when apiKey exists', () => {
      expect(
        inferBedrockAuthMode({
          accessKeyId: 'aws-access-key',
          apiKey: 'bedrock-api-key',
          secretAccessKey: 'aws-secret-key',
        }),
      ).toBe(BedrockAuthMode.ApiKey);
    });

    it('should use AWS credentials mode for legacy credentials', () => {
      expect(inferBedrockAuthMode({ accessKeyId: 'aws-access-key' })).toBe(
        BedrockAuthMode.AwsCredentials,
      );
      expect(inferBedrockAuthMode({ secretAccessKey: 'aws-secret-key' })).toBe(
        BedrockAuthMode.AwsCredentials,
      );
    });
  });

  describe('normalizeBedrockKeyVaultsForAuthMode', () => {
    it('should clear AWS credential fields in API key mode', () => {
      expect(
        normalizeBedrockKeyVaultsForAuthMode(BedrockAuthMode.ApiKey, {
          accessKeyId: 'aws-access-key',
          apiKey: 'bedrock-api-key',
          region: 'us-east-1',
          secretAccessKey: 'aws-secret-key',
          sessionToken: 'session-token',
        }),
      ).toEqual({
        accessKeyId: '',
        apiKey: 'bedrock-api-key',
        region: 'us-east-1',
        secretAccessKey: '',
        sessionToken: '',
      });
    });

    it('should clear API key in AWS credentials mode', () => {
      expect(
        normalizeBedrockKeyVaultsForAuthMode(BedrockAuthMode.AwsCredentials, {
          accessKeyId: 'aws-access-key',
          apiKey: 'bedrock-api-key',
          region: 'us-east-1',
          secretAccessKey: 'aws-secret-key',
        }),
      ).toEqual({
        accessKeyId: 'aws-access-key',
        apiKey: '',
        region: 'us-east-1',
        secretAccessKey: 'aws-secret-key',
      });
    });
  });

  it('should normalize full provider config values', () => {
    expect(
      normalizeBedrockConfigValues(BedrockAuthMode.ApiKey)({
        fetchOnClient: true,
        keyVaults: {
          accessKeyId: 'aws-access-key',
          apiKey: 'bedrock-api-key',
          region: 'us-east-1',
          secretAccessKey: 'aws-secret-key',
        },
      }),
    ).toEqual({
      fetchOnClient: true,
      keyVaults: {
        accessKeyId: '',
        apiKey: 'bedrock-api-key',
        region: 'us-east-1',
        secretAccessKey: '',
        sessionToken: '',
      },
    });
  });
});
