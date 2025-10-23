import { describe, expect, it } from 'vitest';

import type { LobeToolManifest } from '../types';
import { filterValidManifests, validateManifest } from '../utils';

// Mock manifest schemas
const mockBuiltinManifest: LobeToolManifest = {
  api: [
    {
      description: 'Built-in tool',
      name: 'builtinAction',
      parameters: { type: 'object', properties: {} },
    },
  ],
  identifier: 'builtin-tool',
  meta: { title: 'Builtin Tool' },
  type: 'builtin',
};

describe('utils', () => {
  describe('validateManifest', () => {
    it('should validate correct manifest', () => {
      const result = validateManifest(mockBuiltinManifest);

      expect(result).toBe(true);
    });

    it('should reject manifest without identifier', () => {
      const invalidManifest = { ...mockBuiltinManifest, identifier: undefined };

      const result = validateManifest(invalidManifest);

      expect(result).toBe(false);
    });

    it('should reject manifest without api', () => {
      const invalidManifest = { ...mockBuiltinManifest, api: undefined };

      const result = validateManifest(invalidManifest);

      expect(result).toBe(false);
    });

    it('should reject manifest with empty api array', () => {
      const invalidManifest = { ...mockBuiltinManifest, api: [] };

      const result = validateManifest(invalidManifest);

      expect(result).toBe(false);
    });

    it('should reject non-object manifests', () => {
      expect(validateManifest(null)).toBe(false);
      expect(validateManifest(undefined)).toBe(false);
      expect(validateManifest('string')).toBe(false);
      expect(validateManifest(123)).toBe(false);
    });
  });

  describe('filterValidManifests', () => {
    it('should separate valid and invalid manifests', () => {
      const validManifest = mockBuiltinManifest;
      const invalidManifest = { identifier: 'invalid' }; // missing api

      const result = filterValidManifests([validManifest, invalidManifest]);

      expect(result.valid).toEqual([validManifest]);
      expect(result.invalid).toEqual([invalidManifest]);
    });
  });
});
