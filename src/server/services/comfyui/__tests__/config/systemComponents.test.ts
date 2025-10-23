import { describe, expect, it } from 'vitest';

import {
  SYSTEM_COMPONENTS,
  getAllComponentsWithNames,
  getOptimalComponent,
} from '@/server/services/comfyui/config/systemComponents';

describe('SystemComponents', () => {
  describe('SYSTEM_COMPONENTS', () => {
    it('should be a non-empty object with valid structure', () => {
      expect(typeof SYSTEM_COMPONENTS).toBe('object');
      expect(Object.keys(SYSTEM_COMPONENTS).length).toBeGreaterThan(0);

      // Check that all components have required fields
      Object.entries(SYSTEM_COMPONENTS).forEach(([, config]) => {
        expect(config).toBeDefined();
        expect(config.type).toBeDefined();
        expect(config.priority).toBeTypeOf('number');
        expect(config.modelFamily).toBeDefined();
      });
    });

    it('should contain essential component types', () => {
      const types = Object.values(SYSTEM_COMPONENTS).map((c) => c.type);
      const uniqueTypes = [...new Set(types)];

      expect(uniqueTypes).toContain('vae');
      expect(uniqueTypes).toContain('clip');
      expect(uniqueTypes).toContain('t5');
    });

    it('should allow direct access to component config by name', () => {
      const config = SYSTEM_COMPONENTS['ae.safetensors'];
      expect(config).toBeDefined();
      expect(config.type).toBe('vae');
      expect(config.modelFamily).toBe('FLUX');
      expect(config.priority).toBe(1);
    });

    it('should return undefined for invalid component name', () => {
      const config = SYSTEM_COMPONENTS['nonexistent.safetensors'];
      expect(config).toBeUndefined();
    });
  });

  describe('getAllComponentsWithNames', () => {
    it('should return components with names for valid type', () => {
      const result = getAllComponentsWithNames({ type: 'vae' });
      expect(result.length).toBeGreaterThan(0);
      result.forEach(({ name, config }) => {
        expect(name).toBeTypeOf('string');
        expect(config.type).toBe('vae');
      });
    });

    it('should filter by modelFamily when specified', () => {
      const result = getAllComponentsWithNames({ modelFamily: 'FLUX', type: 'vae' });
      expect(result.length).toBeGreaterThan(0);
      result.forEach(({ config }) => {
        expect(config.modelFamily).toBe('FLUX');
        expect(config.type).toBe('vae');
      });
    });

    it('should filter by priority when specified', () => {
      const result = getAllComponentsWithNames({ priority: 1 });
      expect(result.length).toBeGreaterThan(0);
      result.forEach(({ config }) => {
        expect(config.priority).toBe(1);
      });
    });

    it('should filter by multiple criteria', () => {
      const result = getAllComponentsWithNames({
        modelFamily: 'FLUX',
        priority: 1,
        type: 'lora',
      });
      expect(result.length).toBeGreaterThan(0);
      result.forEach(({ config }) => {
        expect(config.type).toBe('lora');
        expect(config.modelFamily).toBe('FLUX');
        expect(config.priority).toBe(1);
      });
    });

    it('should filter by compatible variant', () => {
      const result = getAllComponentsWithNames({
        compatibleVariant: 'dev',
        type: 'lora',
      });
      expect(result.length).toBeGreaterThan(0);
      result.forEach(({ config }) => {
        expect(config.type).toBe('lora');
        expect(config.compatibleVariants).toContain('dev');
      });
    });

    it('should return empty array for invalid filters', () => {
      const result = getAllComponentsWithNames({
        modelFamily: 'NONEXISTENT' as any,
        type: 'vae',
      });
      expect(result).toEqual([]);
    });
  });

  describe('getOptimalComponent', () => {
    it('should return component with highest priority (lowest number) for FLUX VAE', () => {
      const component = getOptimalComponent('vae', 'FLUX');
      expect(component).toBeDefined();
      expect(typeof component).toBe('string');

      // Should return ae.safetensors which has priority 1
      expect(component).toBe('ae.safetensors');
    });

    it('should return component with highest priority for SD1 VAE', () => {
      const component = getOptimalComponent('vae', 'SD1');
      expect(component).toBeDefined();
      expect(typeof component).toBe('string');
    });

    it('should return component with highest priority for FLUX clip', () => {
      const component = getOptimalComponent('clip', 'FLUX');
      expect(component).toBeDefined();
      expect(typeof component).toBe('string');
    });

    it('should throw ConfigError when no components found', () => {
      expect(() => {
        getOptimalComponent('vae', 'NONEXISTENT' as any);
      }).toThrow('No vae components configured for model family NONEXISTENT');
    });
  });
});
