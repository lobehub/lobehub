import { describe, expect, it } from 'vitest';

import { MODEL_REGISTRY } from '@/server/services/comfyui/config/modelRegistry';
import {
  getAllModelNames,
  getModelConfig,
  getModelsByVariant,
} from '@/server/services/comfyui/utils/staticModelLookup';

describe('ModelRegistry', () => {
  describe('MODEL_REGISTRY', () => {
    it('should be a non-empty object with valid structure', () => {
      expect(typeof MODEL_REGISTRY).toBe('object');
      expect(Object.keys(MODEL_REGISTRY).length).toBeGreaterThan(0);

      // Check that all models have required fields
      Object.entries(MODEL_REGISTRY).forEach(([, config]) => {
        expect(config).toBeDefined();
        expect(config.modelFamily).toBeDefined();
        expect(config.priority).toBeTypeOf('number');
        if (config.recommendedDtype) {
          expect(
            ['default', 'fp8_e4m3fn', 'fp8_e4m3fn_fast', 'fp8_e5m2'].includes(
              config.recommendedDtype,
            ),
          ).toBe(true);
        }
      });
    });

    it('should contain essential model families', () => {
      const modelFamilies = Object.values(MODEL_REGISTRY).map((c) => c.modelFamily);
      const uniqueFamilies = [...new Set(modelFamilies)];

      // Should have at least one model family and FLUX should be included
      expect(uniqueFamilies.length).toBeGreaterThan(0);
      expect(uniqueFamilies).toContain('FLUX');
    });

    it('should have valid priority ranges', () => {
      Object.entries(MODEL_REGISTRY).forEach(([, config]) => {
        // Priorities should be positive numbers
        expect(config.priority).toBeGreaterThan(0);
        expect(config.priority).toBeLessThanOrEqual(10);
      });
    });
  });

  describe('getModelConfig', () => {
    it('should return model config for valid name', () => {
      // Get any available FLUX model instead of hardcoding
      const allModelNames = getAllModelNames();
      const fluxModels = allModelNames.filter((name) => {
        const config = getModelConfig(name);
        return config?.modelFamily === 'FLUX';
      });

      expect(fluxModels.length).toBeGreaterThan(0);

      const config = getModelConfig(fluxModels[0]);
      expect(config).toBeDefined();
      expect(config?.modelFamily).toBe('FLUX');
    });

    it('should return undefined for invalid name', () => {
      const config = getModelConfig('nonexistent.safetensors');
      expect(config).toBeUndefined();
    });
  });

  describe('getAllModelNames', () => {
    it('should return all model names', () => {
      const names = getAllModelNames();
      expect(names.length).toBeGreaterThan(0);
      // Check if at least one FLUX model exists instead of hardcoding
      const hasFluxModel = names.some((name) => {
        const config = getModelConfig(name);
        return config?.modelFamily === 'FLUX';
      });
      expect(hasFluxModel).toBe(true);
    });

    it('should return unique names', () => {
      const names = getAllModelNames();
      const uniqueNames = [...new Set(names)];
      expect(uniqueNames.length).toBe(names.length);
    });
  });

  describe('getModelsByVariant', () => {
    it('should return model names for valid variant', () => {
      const modelNames = getModelsByVariant('dev');
      expect(modelNames.length).toBeGreaterThan(0);
      expect(Array.isArray(modelNames)).toBe(true);

      // Verify all returned names are strings and correspond to dev variant models
      modelNames.forEach((name) => {
        expect(typeof name).toBe('string');
        const config = getModelConfig(name);
        expect(config).toBeDefined();
        expect(config?.variant).toBe('dev');
      });
    });

    it('should return models sorted by priority', () => {
      const modelNames = getModelsByVariant('dev');
      expect(modelNames.length).toBeGreaterThan(1);

      // Verify priority sorting (lower priority number = higher priority)
      for (let i = 0; i < modelNames.length - 1; i++) {
        const config1 = getModelConfig(modelNames[i]);
        const config2 = getModelConfig(modelNames[i + 1]);
        expect(config1?.priority).toBeLessThanOrEqual(config2?.priority || 0);
      }
    });

    it('should return empty array for invalid variant', () => {
      const models = getModelsByVariant('nonexistent' as any);
      expect(models).toEqual([]);
    });
  });

  describe('getModelConfig with options', () => {
    it('should support case-insensitive lookup', () => {
      // Get any FLUX dev model for testing case-insensitive lookup
      const allModels = getAllModelNames();
      const fluxDevModel = allModels.find((name) => {
        const config = getModelConfig(name);
        return config?.modelFamily === 'FLUX' && config?.variant === 'dev';
      });

      if (fluxDevModel) {
        const config = getModelConfig(fluxDevModel.toUpperCase(), { caseInsensitive: true });
        expect(config).toBeDefined();
        expect(config?.modelFamily).toBe('FLUX');
        expect(config?.variant).toBe('dev');
      } else {
        // If no dev variant exists, test with any FLUX model
        const fluxModel = allModels.find((name) => {
          const config = getModelConfig(name);
          return config?.modelFamily === 'FLUX';
        });
        expect(fluxModel).toBeDefined();

        const config = getModelConfig(fluxModel!.toUpperCase(), { caseInsensitive: true });
        expect(config).toBeDefined();
        expect(config?.modelFamily).toBe('FLUX');
      }
    });

    it('should return undefined for non-matching case without caseInsensitive option', () => {
      // Find any FLUX model and test uppercase version without case-insensitive flag
      const allModels = getAllModelNames();
      const fluxModel = allModels.find((name) => {
        const config = getModelConfig(name);
        return config?.modelFamily === 'FLUX';
      });

      if (fluxModel) {
        const config = getModelConfig(fluxModel.toUpperCase());
        expect(config).toBeUndefined();
      }
    });

    it('should filter by variant', () => {
      // Find models with different variants for testing
      const allModels = getAllModelNames();
      const devModel = allModels.find((name) => {
        const config = getModelConfig(name);
        return config?.variant === 'dev';
      });

      if (devModel) {
        // Test matching variant
        const config = getModelConfig(devModel, { variant: 'dev' });
        expect(config).toBeDefined();
        expect(config?.variant).toBe('dev');

        // Test non-matching variant
        const nonMatchingConfig = getModelConfig(devModel, { variant: 'schnell' });
        expect(nonMatchingConfig).toBeUndefined();
      }
    });

    it('should filter by modelFamily', () => {
      // 测试 SD3.5 模型家族
      const config = getModelConfig('sd3.5_large.safetensors', { modelFamily: 'SD3' });
      expect(config).toBeDefined();
      expect(config?.modelFamily).toBe('SD3');

      // 测试不匹配的 modelFamily
      const nonMatchingConfig = getModelConfig('sd3.5_large.safetensors', { modelFamily: 'FLUX' });
      expect(nonMatchingConfig).toBeUndefined();
    });

    it('should filter by priority', () => {
      // Find a model with priority 1 for testing
      const allModels = getAllModelNames();
      const priority1Model = allModels.find((name) => {
        const config = getModelConfig(name);
        return config?.priority === 1;
      });

      if (priority1Model) {
        const config = getModelConfig(priority1Model, { priority: 1 });
        expect(config).toBeDefined();

        // Test non-matching priority
        const nonMatchingConfig = getModelConfig(priority1Model, { priority: 999 });
        expect(nonMatchingConfig).toBeUndefined();
      }
    });

    it('should filter by recommendedDtype', () => {
      // flux_shakker_labs_union_pro-fp8_e4m3fn 有 fp8_e4m3fn
      const config = getModelConfig('flux_shakker_labs_union_pro-fp8_e4m3fn.safetensors', {
        recommendedDtype: 'fp8_e4m3fn',
      });
      expect(config).toBeDefined();
      expect(config?.recommendedDtype).toBe('fp8_e4m3fn');

      // 测试不匹配的 recommendedDtype
      const nonMatchingConfig = getModelConfig(
        'flux_shakker_labs_union_pro-fp8_e4m3fn.safetensors',
        { recommendedDtype: 'default' },
      );
      expect(nonMatchingConfig).toBeUndefined();
    });

    it('should combine multiple filters', () => {
      // Find a FLUX dev model with priority 1 for testing
      const allModels = getAllModelNames();
      const testModel = allModels.find((name) => {
        const config = getModelConfig(name);
        return (
          config?.modelFamily === 'FLUX' && config?.variant === 'dev' && config?.priority === 1
        );
      });

      if (testModel) {
        // All filters match
        const config = getModelConfig(testModel, {
          modelFamily: 'FLUX',
          priority: 1,
          variant: 'dev',
        });
        expect(config).toBeDefined();

        // One filter doesn't match
        const nonMatchingConfig = getModelConfig(testModel, {
          modelFamily: 'FLUX',
          priority: 999, // Wrong priority
          variant: 'dev',
        });
        expect(nonMatchingConfig).toBeUndefined();
      }
    });

    it('should handle case-insensitive with other filters', () => {
      // Find a FLUX dev model for testing
      const allModels = getAllModelNames();
      const fluxDevModel = allModels.find((name) => {
        const config = getModelConfig(name);
        return config?.modelFamily === 'FLUX' && config?.variant === 'dev';
      });

      if (fluxDevModel) {
        const config = getModelConfig(fluxDevModel.toUpperCase(), {
          caseInsensitive: true,
          modelFamily: 'FLUX',
          variant: 'dev',
        });
        expect(config).toBeDefined();
      }
    });
  });
});
