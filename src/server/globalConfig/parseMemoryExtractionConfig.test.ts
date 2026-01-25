import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPublicMemoryExtractionConfig,
  parseMemoryExtractionConfig,
} from './parseMemoryExtractionConfig';

describe('parseMemoryExtractionConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all memory-related environment variables
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('MEMORY_USER_MEMORY_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('parseGateKeeperAgent', () => {
    it('should return default values when no environment variables are set', () => {
      const config = parseMemoryExtractionConfig();

      expect(config.agentGateKeeper).toEqual({
        apiKey: undefined,
        baseURL: undefined,
        language: 'English',
        model: 'gpt-5-mini',
        provider: 'openai',
      });
    });

    it('should parse custom gate keeper configuration', () => {
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_API_KEY = 'test-key';
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_BASE_URL = 'https://api.example.com';
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_MODEL = 'gpt-4';
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_PROVIDER = 'azure';
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_LANGUAGE = 'Chinese';

      const config = parseMemoryExtractionConfig();

      expect(config.agentGateKeeper).toEqual({
        apiKey: 'test-key',
        baseURL: 'https://api.example.com',
        language: 'Chinese',
        model: 'gpt-4',
        provider: 'azure',
      });
    });

    it('should handle partial gate keeper configuration', () => {
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_API_KEY = 'partial-key';
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_MODEL = 'claude-3';

      const config = parseMemoryExtractionConfig();

      expect(config.agentGateKeeper).toEqual({
        apiKey: 'partial-key',
        baseURL: undefined,
        language: 'English',
        model: 'claude-3',
        provider: 'openai',
      });
    });
  });

  describe('parseLayerExtractorAgent', () => {
    it('should fallback to gate keeper model when no extractor model is set', () => {
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_MODEL = 'gpt-4';

      const config = parseMemoryExtractionConfig();

      expect(config.agentLayerExtractor.model).toBe('gpt-4');
    });

    it('should parse custom layer extractor configuration', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_API_KEY = 'extractor-key';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_BASE_URL = 'https://extractor.example.com';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL = 'custom-model';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_PROVIDER = 'anthropic';

      const config = parseMemoryExtractionConfig();

      expect(config.agentLayerExtractor).toMatchObject({
        apiKey: 'extractor-key',
        baseURL: 'https://extractor.example.com',
        model: 'custom-model',
        provider: 'anthropic',
      });
    });

    it('should parse context limit correctly', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_LIMIT = '5000';

      const config = parseMemoryExtractionConfig();

      expect(config.agentLayerExtractor.contextLimit).toBe(5000);
    });

    it('should parse layer-specific model overrides', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL = 'base-model';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_MODEL = 'context-model';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_EXPERIENCE_MODEL = 'experience-model';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_IDENTITY_MODEL = 'identity-model';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_PREFERENCE_MODEL = 'preference-model';

      const config = parseMemoryExtractionConfig();

      expect(config.agentLayerExtractor.layers).toEqual({
        context: 'context-model',
        experience: 'experience-model',
        identity: 'identity-model',
        preference: 'preference-model',
      });
    });

    it('should use base model when layer-specific model is not set', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL = 'base-model';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_MODEL = 'context-override';

      const config = parseMemoryExtractionConfig();

      expect(config.agentLayerExtractor.layers).toEqual({
        context: 'context-override',
        experience: 'base-model',
        identity: 'base-model',
        preference: 'base-model',
      });
    });
  });

  describe('parseTokenLimitEnv', () => {
    it('should return undefined for undefined input', () => {
      const config = parseMemoryExtractionConfig();
      expect(config.agentLayerExtractor.contextLimit).toBeUndefined();
    });

    it('should parse valid positive numbers', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_LIMIT = '1000';
      const config = parseMemoryExtractionConfig();
      expect(config.agentLayerExtractor.contextLimit).toBe(1000);
    });

    it('should floor decimal numbers', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_LIMIT = '1234.56';
      const config = parseMemoryExtractionConfig();
      expect(config.agentLayerExtractor.contextLimit).toBe(1234);
    });

    it('should return undefined for zero', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_LIMIT = '0';
      const config = parseMemoryExtractionConfig();
      expect(config.agentLayerExtractor.contextLimit).toBeUndefined();
    });

    it('should return undefined for negative numbers', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_LIMIT = '-100';
      const config = parseMemoryExtractionConfig();
      expect(config.agentLayerExtractor.contextLimit).toBeUndefined();
    });

    it('should return undefined for non-numeric strings', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_LIMIT = 'invalid';
      const config = parseMemoryExtractionConfig();
      expect(config.agentLayerExtractor.contextLimit).toBeUndefined();
    });

    it('should return undefined for Infinity', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_LIMIT = 'Infinity';
      const config = parseMemoryExtractionConfig();
      expect(config.agentLayerExtractor.contextLimit).toBeUndefined();
    });
  });

  describe('parseEmbeddingAgent', () => {
    it('should use fallback values from layer extractor', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL = 'extractor-model';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_PROVIDER = 'anthropic';
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_API_KEY = 'gate-key';

      const config = parseMemoryExtractionConfig();

      expect(config.embedding).toMatchObject({
        apiKey: 'gate-key',
        model: 'extractor-model',
        provider: 'anthropic',
      });
    });

    it('should override with embedding-specific values', () => {
      process.env.MEMORY_USER_MEMORY_EMBEDDING_MODEL = 'embedding-model';
      process.env.MEMORY_USER_MEMORY_EMBEDDING_PROVIDER = 'cohere';
      process.env.MEMORY_USER_MEMORY_EMBEDDING_API_KEY = 'embedding-key';
      process.env.MEMORY_USER_MEMORY_EMBEDDING_BASE_URL = 'https://embedding.example.com';

      const config = parseMemoryExtractionConfig();

      expect(config.embedding).toMatchObject({
        apiKey: 'embedding-key',
        baseURL: 'https://embedding.example.com',
        model: 'embedding-model',
        provider: 'cohere',
      });
    });

    it('should parse embedding context limit', () => {
      process.env.MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT = '2048';

      const config = parseMemoryExtractionConfig();

      expect(config.embedding.contextLimit).toBe(2048);
    });

    it('should fallback to gate keeper API key when layer extractor key is not set', () => {
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_API_KEY = 'gate-key';

      const config = parseMemoryExtractionConfig();

      expect(config.embedding.apiKey).toBe('gate-key');
    });

    it('should prefer gate keeper API key over layer extractor when both are set', () => {
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_API_KEY = 'gate-key';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_API_KEY = 'extractor-key';

      const config = parseMemoryExtractionConfig();

      expect(config.embedding.apiKey).toBe('gate-key');
    });

    it('should use layer extractor API key when gate keeper key is not set', () => {
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_API_KEY = 'extractor-key';

      const config = parseMemoryExtractionConfig();

      expect(config.embedding.apiKey).toBe('extractor-key');
    });
  });

  describe('parseExtractorAgentObservabilityS3', () => {
    it('should return disabled when required fields are missing', () => {
      const config = parseMemoryExtractionConfig();

      expect(config.observabilityS3).toEqual({
        enabled: false,
      });
    });

    it('should return disabled when only access key is set', () => {
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ACCESS_KEY_ID = 'access-key';

      const config = parseMemoryExtractionConfig();

      expect(config.observabilityS3).toEqual({
        enabled: false,
      });
    });

    it('should return disabled when only secret key is set', () => {
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_SECRET_ACCESS_KEY = 'secret-key';

      const config = parseMemoryExtractionConfig();

      expect(config.observabilityS3).toEqual({
        enabled: false,
      });
    });

    it('should return disabled when only endpoint is set', () => {
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ENDPOINT = 'https://s3.example.com';

      const config = parseMemoryExtractionConfig();

      expect(config.observabilityS3).toEqual({
        enabled: false,
      });
    });

    it('should return enabled when all required fields are set', () => {
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ACCESS_KEY_ID = 'access-key';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_SECRET_ACCESS_KEY = 'secret-key';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ENDPOINT = 'https://s3.example.com';

      const config = parseMemoryExtractionConfig();

      expect(config.observabilityS3).toEqual({
        accessKeyId: 'access-key',
        bucketName: undefined,
        enabled: true,
        endpoint: 'https://s3.example.com',
        forcePathStyle: false,
        pathPrefix: undefined,
        region: undefined,
        secretAccessKey: 'secret-key',
      });
    });

    it('should parse all S3 optional fields', () => {
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ACCESS_KEY_ID = 'access-key';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_SECRET_ACCESS_KEY = 'secret-key';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ENDPOINT = 'https://s3.example.com';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_BUCKET_NAME = 'my-bucket';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_REGION = 'us-west-2';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_FORCE_PATH_STYLE = 'true';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_PATH_PREFIX = 'observability/';

      const config = parseMemoryExtractionConfig();

      expect(config.observabilityS3).toEqual({
        accessKeyId: 'access-key',
        bucketName: 'my-bucket',
        enabled: true,
        endpoint: 'https://s3.example.com',
        forcePathStyle: true,
        pathPrefix: 'observability/',
        region: 'us-west-2',
        secretAccessKey: 'secret-key',
      });
    });

    it('should parse forcePathStyle as false when not "true"', () => {
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ACCESS_KEY_ID = 'access-key';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_SECRET_ACCESS_KEY = 'secret-key';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ENDPOINT = 'https://s3.example.com';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_FORCE_PATH_STYLE = 'false';

      const config = parseMemoryExtractionConfig();

      expect(config.observabilityS3!.forcePathStyle).toBe(false);
    });
  });

  describe('featureFlags', () => {
    it('should default to false when not set', () => {
      const config = parseMemoryExtractionConfig();

      expect(config.featureFlags.enableBenchmarkLoCoMo).toBe(false);
    });

    it('should parse feature flag as true', () => {
      process.env.MEMORY_USER_MEMORY_FEATURE_FLAG_BENCHMARK_LOCOMO = 'true';

      const config = parseMemoryExtractionConfig();

      expect(config.featureFlags.enableBenchmarkLoCoMo).toBe(true);
    });

    it('should parse feature flag as false when not "true"', () => {
      process.env.MEMORY_USER_MEMORY_FEATURE_FLAG_BENCHMARK_LOCOMO = 'false';

      const config = parseMemoryExtractionConfig();

      expect(config.featureFlags.enableBenchmarkLoCoMo).toBe(false);
    });
  });

  describe('concurrency', () => {
    it('should return undefined when not set', () => {
      const config = parseMemoryExtractionConfig();

      expect(config.concurrency).toBeUndefined();
    });

    it('should parse valid positive integer', () => {
      process.env.MEMORY_USER_MEMORY_CONCURRENCY = '5';

      const config = parseMemoryExtractionConfig();

      expect(config.concurrency).toBe(5);
    });

    it('should return undefined for zero', () => {
      process.env.MEMORY_USER_MEMORY_CONCURRENCY = '0';

      const config = parseMemoryExtractionConfig();

      expect(config.concurrency).toBeUndefined();
    });

    it('should return undefined for negative numbers', () => {
      process.env.MEMORY_USER_MEMORY_CONCURRENCY = '-1';

      const config = parseMemoryExtractionConfig();

      expect(config.concurrency).toBeUndefined();
    });

    it('should return undefined for decimal numbers', () => {
      process.env.MEMORY_USER_MEMORY_CONCURRENCY = '3.5';

      const config = parseMemoryExtractionConfig();

      expect(config.concurrency).toBeUndefined();
    });

    it('should return undefined for non-numeric strings', () => {
      process.env.MEMORY_USER_MEMORY_CONCURRENCY = 'invalid';

      const config = parseMemoryExtractionConfig();

      expect(config.concurrency).toBeUndefined();
    });
  });

  describe('whitelistUsers', () => {
    it('should return undefined when not set', () => {
      const config = parseMemoryExtractionConfig();

      expect(config.whitelistUsers).toBeUndefined();
    });

    it('should parse comma-separated user list', () => {
      process.env.MEMORY_USER_MEMORY_WHITELIST_USERS = 'user1,user2,user3';

      const config = parseMemoryExtractionConfig();

      expect(config.whitelistUsers).toEqual(['user1', 'user2', 'user3']);
    });

    it('should trim whitespace from user IDs', () => {
      process.env.MEMORY_USER_MEMORY_WHITELIST_USERS = '  user1  ,  user2  ,  user3  ';

      const config = parseMemoryExtractionConfig();

      expect(config.whitelistUsers).toEqual(['user1', 'user2', 'user3']);
    });

    it('should filter out empty strings', () => {
      process.env.MEMORY_USER_MEMORY_WHITELIST_USERS = 'user1,,user2,';

      const config = parseMemoryExtractionConfig();

      expect(config.whitelistUsers).toEqual(['user1', 'user2']);
    });

    it('should handle single user', () => {
      process.env.MEMORY_USER_MEMORY_WHITELIST_USERS = 'single-user';

      const config = parseMemoryExtractionConfig();

      expect(config.whitelistUsers).toEqual(['single-user']);
    });
  });

  describe('webhookHeaders', () => {
    it('should return undefined when not set', () => {
      const config = parseMemoryExtractionConfig();

      expect(config.webhookHeaders).toBeUndefined();
    });

    it('should parse key-value pairs', () => {
      process.env.MEMORY_USER_MEMORY_WEBHOOK_HEADERS = 'Authorization=Bearer token,X-Custom=value';

      const config = parseMemoryExtractionConfig();

      expect(config.webhookHeaders).toEqual({
        'Authorization': 'Bearer token',
        'X-Custom': 'value',
      });
    });

    it('should trim whitespace from keys and values', () => {
      process.env.MEMORY_USER_MEMORY_WEBHOOK_HEADERS =
        '  Authorization = Bearer token  ,  X-Custom = value  ';

      const config = parseMemoryExtractionConfig();

      expect(config.webhookHeaders).toEqual({
        'Authorization': 'Bearer token',
        'X-Custom': 'value',
      });
    });

    it('should ignore entries without values', () => {
      process.env.MEMORY_USER_MEMORY_WEBHOOK_HEADERS =
        'Authorization=Bearer token,InvalidEntry,X-Custom=value';

      const config = parseMemoryExtractionConfig();

      expect(config.webhookHeaders).toEqual({
        'Authorization': 'Bearer token',
        'X-Custom': 'value',
      });
    });

    it('should ignore entries without keys', () => {
      process.env.MEMORY_USER_MEMORY_WEBHOOK_HEADERS = '=value,Authorization=Bearer token';

      const config = parseMemoryExtractionConfig();

      expect(config.webhookHeaders).toEqual({
        Authorization: 'Bearer token',
      });
    });

    it('should handle empty string', () => {
      process.env.MEMORY_USER_MEMORY_WEBHOOK_HEADERS = '';

      const config = parseMemoryExtractionConfig();

      expect(config.webhookHeaders).toEqual({});
    });
  });

  describe('upstashWorkflowExtraHeaders', () => {
    it('should return undefined when not set', () => {
      const config = parseMemoryExtractionConfig();

      expect(config.upstashWorkflowExtraHeaders).toBeUndefined();
    });

    it('should parse key-value pairs', () => {
      process.env.MEMORY_USER_MEMORY_WORKFLOW_EXTRA_HEADERS = 'X-Workflow-ID=123,X-Tenant=tenant1';

      const config = parseMemoryExtractionConfig();

      expect(config.upstashWorkflowExtraHeaders).toEqual({
        'X-Workflow-ID': '123',
        'X-Tenant': 'tenant1',
      });
    });

    it('should trim whitespace from keys and values', () => {
      process.env.MEMORY_USER_MEMORY_WORKFLOW_EXTRA_HEADERS =
        '  X-Workflow-ID = 123  ,  X-Tenant = tenant1  ';

      const config = parseMemoryExtractionConfig();

      expect(config.upstashWorkflowExtraHeaders).toEqual({
        'X-Workflow-ID': '123',
        'X-Tenant': 'tenant1',
      });
    });

    it('should filter out invalid entries', () => {
      process.env.MEMORY_USER_MEMORY_WORKFLOW_EXTRA_HEADERS = 'X-Valid=value,InvalidEntry,,=empty';

      const config = parseMemoryExtractionConfig();

      expect(config.upstashWorkflowExtraHeaders).toEqual({
        'X-Valid': 'value',
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle fully configured memory extraction setup', () => {
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_API_KEY = 'gate-key';
      process.env.MEMORY_USER_MEMORY_GATEKEEPER_MODEL = 'gpt-4';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_API_KEY = 'extractor-key';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL = 'claude-3';
      process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_LIMIT = '4000';
      process.env.MEMORY_USER_MEMORY_EMBEDDING_MODEL = 'text-embedding-3-large';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ACCESS_KEY_ID = 's3-key';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_SECRET_ACCESS_KEY = 's3-secret';
      process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ENDPOINT = 'https://s3.amazonaws.com';
      process.env.MEMORY_USER_MEMORY_CONCURRENCY = '10';
      process.env.MEMORY_USER_MEMORY_WHITELIST_USERS = 'user1,user2';
      process.env.MEMORY_USER_MEMORY_WEBHOOK_HEADERS = 'Authorization=Bearer token';

      const config = parseMemoryExtractionConfig();

      expect(config.agentGateKeeper.model).toBe('gpt-4');
      expect(config.agentLayerExtractor.model).toBe('claude-3');
      expect(config.agentLayerExtractor.contextLimit).toBe(4000);
      expect(config.embedding.model).toBe('text-embedding-3-large');
      expect(config.observabilityS3!.enabled).toBe(true);
      expect(config.concurrency).toBe(10);
      expect(config.whitelistUsers).toEqual(['user1', 'user2']);
      expect(config.webhookHeaders).toEqual({ Authorization: 'Bearer token' });
    });

    it('should handle minimal configuration with defaults', () => {
      const config = parseMemoryExtractionConfig();

      expect(config.agentGateKeeper.model).toBe('gpt-5-mini');
      expect(config.agentGateKeeper.provider).toBe('openai');
      expect(config.agentLayerExtractor.model).toBe('gpt-5-mini');
      expect(config.observabilityS3!.enabled).toBe(false);
      expect(config.concurrency).toBeUndefined();
      expect(config.whitelistUsers).toBeUndefined();
    });
  });
});

describe('getPublicMemoryExtractionConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('MEMORY_USER_MEMORY_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should sanitize API keys from agents', () => {
    process.env.MEMORY_USER_MEMORY_GATEKEEPER_API_KEY = 'secret-key';
    process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_API_KEY = 'another-secret';
    process.env.MEMORY_USER_MEMORY_EMBEDDING_API_KEY = 'embedding-secret';

    const config = getPublicMemoryExtractionConfig();

    expect((config.agentGateKeeper as any).apiKey).toBeUndefined();
    expect((config.agentLayerExtractor as any).apiKey).toBeUndefined();
    expect((config.embedding as any)!.apiKey).toBeUndefined();
  });

  it('should preserve non-sensitive configuration', () => {
    process.env.MEMORY_USER_MEMORY_GATEKEEPER_MODEL = 'gpt-4';
    process.env.MEMORY_USER_MEMORY_GATEKEEPER_BASE_URL = 'https://api.example.com';
    process.env.MEMORY_USER_MEMORY_GATEKEEPER_PROVIDER = 'azure';

    const config = getPublicMemoryExtractionConfig();

    expect(config.agentGateKeeper.model).toBe('gpt-4');
    expect(config.agentGateKeeper.baseURL).toBe('https://api.example.com');
    expect(config.agentGateKeeper.provider).toBe('azure');
  });

  it('should include layer configurations', () => {
    process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL = 'base-model';
    process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_MODEL = 'context-model';

    const config = getPublicMemoryExtractionConfig();

    expect(config.agentLayerExtractor.layers).toEqual({
      context: 'context-model',
      experience: 'base-model',
      identity: 'base-model',
      preference: 'base-model',
    });
  });

  it('should include concurrency in public config', () => {
    process.env.MEMORY_USER_MEMORY_CONCURRENCY = '5';

    const config = getPublicMemoryExtractionConfig();

    expect(config.concurrency).toBe(5);
  });

  it('should not include observability S3 config in public config', () => {
    process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ACCESS_KEY_ID = 's3-key';
    process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_SECRET_ACCESS_KEY = 's3-secret';
    process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ENDPOINT = 'https://s3.amazonaws.com';

    const config = getPublicMemoryExtractionConfig();

    expect((config as any).observabilityS3).toBeUndefined();
  });

  it('should not include webhook headers in public config', () => {
    process.env.MEMORY_USER_MEMORY_WEBHOOK_HEADERS = 'Authorization=Bearer token';

    const config = getPublicMemoryExtractionConfig();

    expect((config as any).webhookHeaders).toBeUndefined();
  });

  it('should not include whitelist users in public config', () => {
    process.env.MEMORY_USER_MEMORY_WHITELIST_USERS = 'user1,user2';

    const config = getPublicMemoryExtractionConfig();

    expect((config as any).whitelistUsers).toBeUndefined();
  });
});
