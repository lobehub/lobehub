// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { parametersFixture } from '@/server/services/comfyui/__tests__/fixtures/parameters.fixture';
import { mockContext } from '@/server/services/comfyui/__tests__/helpers/mockContext';
import { setupAllMocks } from '@/server/services/comfyui/__tests__/setup/unifiedMocks';
// Import transformation utilities
import { buildFluxDevWorkflow } from '@/server/services/comfyui/workflows/flux-dev';
import { buildFluxKontextWorkflow } from '@/server/services/comfyui/workflows/flux-kontext';

describe('Parameter Transformation Tests', () => {
  let inputCalls: Map<string, any>;

  beforeEach(() => {
    const mocks = setupAllMocks();
    inputCalls = mocks.inputCalls;
  });

  describe('AspectRatio Transformation', () => {
    it.each(parametersFixture.transformations.aspectRatio)(
      'should handle aspectRatio $input correctly',
      async ({ input }) => {
        const params = {
          prompt: 'test prompt',
          ...parametersFixture.models['flux-dev'].defaults,
          aspectRatio: input,
        };

        // Should successfully build workflow
        await expect(
          buildFluxDevWorkflow('flux-dev.safetensors', params, mockContext),
        ).resolves.toBeDefined();
      },
    );
  });

  describe('Image URL Processing', () => {
    it('should process imageUrl for img2img workflows', async () => {
      const params = {
        prompt: 'test prompt',
        imageUrl: 'test-image.png',
        strength: 0.8,
      };

      // Kontext supports img2img
      await expect(
        buildFluxKontextWorkflow('flux-kontext.safetensors', params, mockContext),
      ).resolves.toBeDefined();
    });

    it('should handle missing imageUrl gracefully', async () => {
      const params = {
        prompt: 'test prompt',
        // No imageUrl provided
      };

      // Should build normally (may fallback to txt2img mode)
      await expect(
        buildFluxKontextWorkflow('flux-kontext.safetensors', params, mockContext),
      ).resolves.toBeDefined();
    });
  });

  describe('Parameter Validation', () => {
    it('should handle valid parameter ranges', () => {
      Object.entries(parametersFixture.models).forEach(([modelName, config]) => {
        const { min, max } = (config as any).boundaries!;

        // Minimum values within range
        Object.entries(min).forEach(([key, value]) => {
          expect(typeof value).toBe('number');
          expect(value).toBeGreaterThanOrEqual(0);
        });

        // Maximum values within reasonable range
        Object.entries(max).forEach(([key, value]) => {
          expect(typeof value).toBe('number');
          if (key === 'cfg') {
            expect(value).toBeLessThanOrEqual(20);
          }
          if (key === 'steps') {
            expect(value).toBeLessThanOrEqual(150);
          }
        });
      });
    });
  });
});
