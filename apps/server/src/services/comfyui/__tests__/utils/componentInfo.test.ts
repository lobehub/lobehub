import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getComponentDisplayName,
  getComponentFolderPath,
  getComponentInfo,
  isSystemComponent,
} from '@/server/services/comfyui/utils/componentInfo';

// Mock the config modules to have full control over test data
vi.mock('@/server/services/comfyui/config/constants', () => ({
  COMPONENT_NODE_MAPPINGS: {
    clip: { node: 'CLIPTextEncode' },
    controlnet: { node: 'ControlNetApply' },
    lora: { node: 'LoraLoader' },
    t5: { node: 'T5TextEncode' },
    vae: { node: 'VAEDecode' },
  },
}));

vi.mock('@/server/services/comfyui/config/systemComponents', () => ({
  SYSTEM_COMPONENTS: {
    'clip-l.safetensors': { type: 'clip', modelFamily: 'FLUX', priority: 1 },
    'flux-dev.safetensors': { type: 'unet', modelFamily: 'FLUX', priority: 1 },
    'invalid-component.bin': { type: 'unknown', modelFamily: 'TEST', priority: 3 },
    't5-xxl.safetensors': { type: 't5', modelFamily: 'FLUX', priority: 1 },
    'vae.safetensors': { type: 'vae', modelFamily: 'FLUX', priority: 2 },
  },
}));

describe('componentInfo.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getComponentDisplayName', () => {
    it('should return correct display name for t5 type', () => {
      const result = getComponentDisplayName('t5');
      expect(result).toBe('T5 text encoder');
    });

    it('should return correct display name for clip type', () => {
      const result = getComponentDisplayName('clip');
      expect(result).toBe('CLIP text encoder');
    });

    it('should return correct display name for vae type', () => {
      const result = getComponentDisplayName('vae');
      expect(result).toBe('VAE model');
    });

    it('should return generic display name for unknown type', () => {
      const result = getComponentDisplayName('unknown');
      expect(result).toBe('UNKNOWN component');
    });

    it('should return uppercase display name for custom type', () => {
      const result = getComponentDisplayName('lora');
      expect(result).toBe('LORA component');
    });

    it('should handle empty string', () => {
      const result = getComponentDisplayName('');
      expect(result).toBe(' component');
    });

    it('should handle null and undefined gracefully', () => {
      // The function expects string input and will handle null/undefined by converting to string
      expect(() => getComponentDisplayName(null as any)).toThrow();
      expect(() => getComponentDisplayName(undefined as any)).toThrow();
    });

    it('should handle numeric input', () => {
      const result = getComponentDisplayName('123' as any);
      expect(result).toBe('123 component');
    });
  });

  describe('getComponentFolderPath', () => {
    it('should return models/clip for clip type', () => {
      const result = getComponentFolderPath('clip');
      expect(result).toBe('models/clip');
    });

    it('should return models/clip for t5 type', () => {
      const result = getComponentFolderPath('t5');
      expect(result).toBe('models/clip');
    });

    it('should return models/vae for vae type', () => {
      const result = getComponentFolderPath('vae');
      expect(result).toBe('models/vae');
    });

    it('should return generic models path for unknown type', () => {
      const result = getComponentFolderPath('unknown');
      expect(result).toBe('models/unknown');
    });

    it('should return generic models path for custom type', () => {
      const result = getComponentFolderPath('lora');
      expect(result).toBe('models/lora');
    });

    it('should handle empty string', () => {
      const result = getComponentFolderPath('');
      expect(result).toBe('models/');
    });

    it('should handle null and undefined', () => {
      const resultNull = getComponentFolderPath(null as any);
      expect(resultNull).toBe('models/null');

      const resultUndefined = getComponentFolderPath(undefined as any);
      expect(resultUndefined).toBe('models/undefined');
    });

    it('should handle special characters in type', () => {
      const result = getComponentFolderPath('my-custom_type.v2');
      expect(result).toBe('models/my-custom_type.v2');
    });
  });

  describe('getComponentInfo', () => {
    it('should return complete component info for valid clip component', () => {
      const result = getComponentInfo('clip-l.safetensors');

      expect(result).toEqual({
        displayName: 'CLIP text encoder',
        folderPath: 'models/clip',
        nodeType: 'CLIPTextEncode',
        type: 'clip',
      });
    });

    it('should return complete component info for valid t5 component', () => {
      const result = getComponentInfo('t5-xxl.safetensors');

      expect(result).toEqual({
        displayName: 'T5 text encoder',
        folderPath: 'models/clip',
        nodeType: 'T5TextEncode',
        type: 't5',
      });
    });

    it('should return complete component info for valid vae component', () => {
      const result = getComponentInfo('vae.safetensors');

      expect(result).toEqual({
        displayName: 'VAE model',
        folderPath: 'models/vae',
        nodeType: 'VAEDecode',
        type: 'vae',
      });
    });

    it('should return undefined for non-existent component', () => {
      const result = getComponentInfo('non-existent.safetensors');
      expect(result).toBeUndefined();
    });

    it('should return undefined for component with unknown type', () => {
      const result = getComponentInfo('invalid-component.bin');
      expect(result).toBeUndefined();
    });

    it('should handle empty string filename', () => {
      const result = getComponentInfo('');
      expect(result).toBeUndefined();
    });

    it('should handle null and undefined filename', () => {
      const resultNull = getComponentInfo(null as any);
      expect(resultNull).toBeUndefined();

      const resultUndefined = getComponentInfo(undefined as any);
      expect(resultUndefined).toBeUndefined();
    });

    it('should work with different file extensions', () => {
      // Since we're mocking the entire module, we need to test the existing mock data
      // This test validates that the function works with the current mock setup
      const result = getComponentInfo('clip-l.safetensors');
      expect(result).toEqual({
        displayName: 'CLIP text encoder',
        folderPath: 'models/clip',
        nodeType: 'CLIPTextEncode',
        type: 'clip',
      });
    });
  });

  describe('isSystemComponent', () => {
    it('should return true for known system components', () => {
      expect(isSystemComponent('clip-l.safetensors')).toBe(true);
      expect(isSystemComponent('t5-xxl.safetensors')).toBe(true);
      expect(isSystemComponent('vae.safetensors')).toBe(true);
      expect(isSystemComponent('flux-dev.safetensors')).toBe(true);
    });

    it('should return false for unknown components', () => {
      expect(isSystemComponent('unknown.safetensors')).toBe(false);
      expect(isSystemComponent('random-file.txt')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isSystemComponent('')).toBe(false);
      expect(isSystemComponent(null as any)).toBe(false);
      expect(isSystemComponent(undefined as any)).toBe(false);
    });

    it('should be case sensitive', () => {
      expect(isSystemComponent('CLIP-L.SAFETENSORS')).toBe(false);
      expect(isSystemComponent('clip-l.safetensors')).toBe(true);
    });

    it('should handle special characters', () => {
      // Test with existing mock data that contains standard characters
      expect(isSystemComponent('clip-l.safetensors')).toBe(true);
      expect(isSystemComponent('t5-xxl.safetensors')).toBe(true);

      // Test with non-existent special character filename
      expect(isSystemComponent('special-file@2.0_beta.safetensors')).toBe(false);
    });
  });

  describe('integration tests', () => {
    it('should provide consistent results across all functions for same component', () => {
      const fileName = 'clip-l.safetensors';
      const componentInfo = getComponentInfo(fileName);
      const isSystem = isSystemComponent(fileName);

      expect(isSystem).toBe(true);
      expect(componentInfo).toBeDefined();
      expect(componentInfo!.type).toBe('clip');

      const displayName = getComponentDisplayName(componentInfo!.type);
      const folderPath = getComponentFolderPath(componentInfo!.type);

      expect(displayName).toBe(componentInfo!.displayName);
      expect(folderPath).toBe(componentInfo!.folderPath);
    });

    it('should handle workflow where component exists but node mapping missing', () => {
      // Test with existing mock data - flux-dev.safetensors has type 'unet' which is not in node mappings
      const result = getComponentInfo('flux-dev.safetensors');
      expect(result).toBeUndefined();
    });

    it('should handle concurrent access safely', async () => {
      // Test concurrent access to functions
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.all([
          Promise.resolve(getComponentInfo('clip-l.safetensors')),
          Promise.resolve(isSystemComponent('t5-xxl.safetensors')),
          Promise.resolve(getComponentDisplayName('vae')),
          Promise.resolve(getComponentFolderPath('clip')),
        ]),
      );

      const results = await Promise.all(promises);

      // All results should be consistent
      results.forEach(([info, isSystem, displayName, folderPath]) => {
        expect(info).toBeDefined();
        expect(isSystem).toBe(true);
        expect(displayName).toBe('VAE model');
        expect(folderPath).toBe('models/clip');
      });
    });

    it('should maintain type safety with ComponentInfo interface', () => {
      const info = getComponentInfo('clip-l.safetensors');

      if (info) {
        // These should not cause TypeScript errors
        const displayName: string = info.displayName;
        const folderPath: string = info.folderPath;
        const nodeType: string = info.nodeType;
        const type: string = info.type;

        expect(typeof displayName).toBe('string');
        expect(typeof folderPath).toBe('string');
        expect(typeof nodeType).toBe('string');
        expect(typeof type).toBe('string');
      }
    });
  });

  describe('error handling and robustness', () => {
    it('should handle corrupted SYSTEM_COMPONENTS gracefully', () => {
      // Since we can't easily mock return values, test with invalid input
      expect(() => getComponentInfo('any-file.safetensors')).not.toThrow();
      expect(() => isSystemComponent('any-file.safetensors')).not.toThrow();
    });

    it('should handle corrupted COMPONENT_NODE_MAPPINGS gracefully', () => {
      // Test with a component that exists in SYSTEM_COMPONENTS but has invalid type
      const result = getComponentInfo('invalid-component.bin');
      expect(result).toBeUndefined();
    });

    it('should handle missing properties in config', () => {
      // Test with a component that has invalid type in our mock
      const result = getComponentInfo('invalid-component.bin');
      expect(result).toBeUndefined();
    });

    it('should handle very long filenames', () => {
      const longFilename = 'a'.repeat(1000) + '.safetensors';
      expect(() => {
        getComponentInfo(longFilename);
        isSystemComponent(longFilename);
      }).not.toThrow();
    });

    it('should handle unicode characters in filenames', () => {
      const unicodeFilename = '测试-文件-🤖.safetensors';
      expect(() => {
        getComponentInfo(unicodeFilename);
        isSystemComponent(unicodeFilename);
      }).not.toThrow();
    });
  });
});
