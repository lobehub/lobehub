// @vitest-environment node
import { GoogleGenAI } from '@google/genai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../../types/error';
import { LobeGoogleAI } from '../google';
import { LobeVertexAI } from './index';

// Mock dependencies
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation((options) => {
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
  LobeGoogleAI: vi.fn().mockImplementation(() => ({
    chat: vi.fn(),
    models: vi.fn(),
  })),
}));

describe('LobeVertexAI', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

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

    it('should pass modelIdMapping to LobeGoogleAI without passing it to GoogleGenAI', () => {
      LobeVertexAI.initFromVertexAI({
        location: 'us-central1',
        modelIdMapping: { 'logical-gemini': 'vertex-upstream' },
        project: 'test-project',
      });

      const googleGenAIOptions = vi.mocked(GoogleGenAI).mock.calls.at(-1)?.[0] as any;
      const lobeGoogleAIOptions = vi.mocked(LobeGoogleAI).mock.calls.at(-1)?.[0] as any;

      expect(googleGenAIOptions.modelIdMapping).toBeUndefined();
      expect(lobeGoogleAIOptions).toMatchObject({
        isVertexAi: true,
        modelIdMapping: { 'logical-gemini': 'vertex-upstream' },
      });
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
