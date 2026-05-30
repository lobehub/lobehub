import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

describe('parseMemoryExtractionConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MEMORY_USER_MEMORY_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MEMORY_USER_MEMORY_') && !(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  describe('rate limiting configuration', () => {
    describe('MEMORY_USER_MEMORY_RPM', () => {
      it('should parse valid positive number', () => {
        process.env.MEMORY_USER_MEMORY_RPM = '30';
        const config = parseMemoryExtractionConfig();
        expect(config.rateLimit?.rpm).toBe(30);
      });

      it('should ignore negative numbers', () => {
        process.env.MEMORY_USER_MEMORY_RPM = '-5';
        const config = parseMemoryExtractionConfig();
        expect(config.rateLimit?.rpm).toBeUndefined();
      });

      it('should ignore zero', () => {
        process.env.MEMORY_USER_MEMORY_RPM = '0';
        const config = parseMemoryExtractionConfig();
        expect(config.rateLimit?.rpm).toBeUndefined();
      });

      it('should ignore non-numeric strings', () => {
        process.env.MEMORY_USER_MEMORY_RPM = 'abc';
        const config = parseMemoryExtractionConfig();
        expect(config.rateLimit?.rpm).toBeUndefined();
      });
    });

    describe('MEMORY_USER_MEMORY_TPM', () => {
      it('should parse valid positive number', () => {
        process.env.MEMORY_USER_MEMORY_TPM = '10000';
        const config = parseMemoryExtractionConfig();
        expect(config.rateLimit?.tpm).toBe(10000);
      });

      it('should ignore invalid values', () => {
        process.env.MEMORY_USER_MEMORY_TPM = '-100';
        const config = parseMemoryExtractionConfig();
        expect(config.rateLimit?.tpm).toBeUndefined();
      });
    });

    describe('rateLimit object', () => {
      it('should be undefined when no rate limit env vars set', () => {
        const config = parseMemoryExtractionConfig();
        expect(config.rateLimit).toBeUndefined();
      });

      it('should be defined when at least one rate limit env var is set', () => {
        process.env.MEMORY_USER_MEMORY_RPM = '10';
        const config = parseMemoryExtractionConfig();
        expect(config.rateLimit).toBeDefined();
      });

      it('should include only defined fields', () => {
        process.env.MEMORY_USER_MEMORY_RPM = '10';
        process.env.MEMORY_USER_MEMORY_TPM = '5000';
        const config = parseMemoryExtractionConfig();
        expect(config.rateLimit).toEqual({ rpm: 10, tpm: 5000 });
      });
    });
  });

  describe('MEMORY_USER_MEMORY_WORKFLOW_PARALLELISM', () => {
    it('should parse valid positive integer', () => {
      process.env.MEMORY_USER_MEMORY_WORKFLOW_PARALLELISM = '4';
      const config = parseMemoryExtractionConfig();
      expect(config.workflowParallelism).toBe(4);
    });

    it('should ignore non-integer values', () => {
      process.env.MEMORY_USER_MEMORY_WORKFLOW_PARALLELISM = '2.5';
      const config = parseMemoryExtractionConfig();
      expect(config.workflowParallelism).toBeUndefined();
    });

    it('should ignore zero and negative values', () => {
      process.env.MEMORY_USER_MEMORY_WORKFLOW_PARALLELISM = '0';
      const config = parseMemoryExtractionConfig();
      expect(config.workflowParallelism).toBeUndefined();
    });

    it('should be undefined when env not set', () => {
      const config = parseMemoryExtractionConfig();
      expect(config.workflowParallelism).toBeUndefined();
    });
  });

  describe('MEMORY_USER_MEMORY_USE_IN_PROCESS_SCHEDULER', () => {
    it('should be true when set to "true"', () => {
      process.env.MEMORY_USER_MEMORY_USE_IN_PROCESS_SCHEDULER = 'true';
      const config = parseMemoryExtractionConfig();
      expect(config.useInProcessScheduler).toBe(true);
    });

    it('should be false when set to anything else', () => {
      process.env.MEMORY_USER_MEMORY_USE_IN_PROCESS_SCHEDULER = 'yes';
      const config = parseMemoryExtractionConfig();
      expect(config.useInProcessScheduler).toBe(false);
    });

    it('should be false when not set', () => {
      const config = parseMemoryExtractionConfig();
      expect(config.useInProcessScheduler).toBe(false);
    });
  });

  describe('integration', () => {
    it('should include all new fields in returned config object', () => {
      process.env.MEMORY_USER_MEMORY_RPM = '10';
      process.env.MEMORY_USER_MEMORY_TPM = '5000';
      process.env.MEMORY_USER_MEMORY_WORKFLOW_PARALLELISM = '3';
      process.env.MEMORY_USER_MEMORY_USE_IN_PROCESS_SCHEDULER = 'true';

      const config = parseMemoryExtractionConfig();

      expect(config.rateLimit).toEqual({ rpm: 10, tpm: 5000 });
      expect(config.workflowParallelism).toBe(3);
      expect(config.useInProcessScheduler).toBe(true);
    });

    it('should work with no env vars set', () => {
      const config = parseMemoryExtractionConfig();
      expect(config.rateLimit).toBeUndefined();
      expect(config.workflowParallelism).toBeUndefined();
      expect(config.useInProcessScheduler).toBe(false);
    });
  });
});
