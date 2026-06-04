// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../../types/error';
import { LobeVertexAI } from './index';

// Mock dependencies
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function (options) {
    if (options.location === 'error-location') {
      const error = new Error('Illegal argument');
      error.name = 'IllegalArgumentError';
      throw error;
    }
    return {
      generateContent: vi.fn(),
    };
  }),
}));

vi.mock('../google', () => ({
  LobeGoogleAI: vi.fn().mockImplementation(function () {
    return {
      chat: vi.fn(),
      models: vi.fn(),
    };
  }),
}));

describe('LobeVertexAI', () => {
  describe('initFromVertexAI', () => {
    it('should create LobeVertexAI instance with default location', () => {
      const instance = LobeVertexAI.initFromVertexAI();
      expect(instance).toBeDefined();
    });

    it('should create LobeVertexAI instance with custom location', () => {
      const instance = LobeVertexAI.initFromVertexAI({
        location: 'us-central1',
        project: 'test-project',
      });
      expect(instance).toBeDefined();
    });

    it('should throw InvalidVertexCredentials error when IllegalArgumentError occurs', () => {
      try {
        LobeVertexAI.initFromVertexAI({
          location: 'error-location',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.errorType).toBe(AgentRuntimeErrorType.InvalidVertexCredentials);
      }
    });
  });
});
