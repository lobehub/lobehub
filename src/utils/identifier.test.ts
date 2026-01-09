import { describe, expect, it } from 'vitest';

import { standardizeIdentifier } from './identifier';

describe('standardizeIdentifier', () => {
  describe('extracting ID from prefixed identifiers', () => {
    it('should extract ID from docs_ prefix', () => {
      expect(standardizeIdentifier('docs_123')).toBe('123');
    });

    it('should extract ID from agt_ prefix', () => {
      expect(standardizeIdentifier('agt_456')).toBe('456');
    });

    it('should extract ID from any custom prefix', () => {
      expect(standardizeIdentifier('custom_789')).toBe('789');
    });

    it('should extract ID from identifier with multiple underscores', () => {
      // split('_')[1] only takes the second part, so 'docs_abc_def_123' becomes 'abc'
      expect(standardizeIdentifier('docs_abc_def_123')).toBe('abc');
    });

    it('should handle numeric IDs', () => {
      expect(standardizeIdentifier('docs_12345')).toBe('12345');
    });

    it('should handle alphanumeric IDs', () => {
      expect(standardizeIdentifier('agt_abc123xyz')).toBe('abc123xyz');
    });
  });

  describe('adding prefix to plain identifiers', () => {
    it('should add docs prefix when specified', () => {
      expect(standardizeIdentifier('123', 'docs')).toBe('docs_123');
    });

    it('should add agt prefix when specified', () => {
      expect(standardizeIdentifier('456', 'agt')).toBe('agt_456');
    });

    it('should add prefix to alphanumeric identifier', () => {
      expect(standardizeIdentifier('abc123', 'docs')).toBe('docs_abc123');
    });

    it('should add prefix to string identifier', () => {
      expect(standardizeIdentifier('my-identifier', 'agt')).toBe('agt_my-identifier');
    });
  });

  describe('returning identifier unchanged', () => {
    it('should return plain identifier unchanged when no prefix specified', () => {
      expect(standardizeIdentifier('123')).toBe('123');
    });

    it('should return plain alphanumeric identifier unchanged when no prefix specified', () => {
      expect(standardizeIdentifier('abc123')).toBe('abc123');
    });

    it('should return plain string identifier unchanged when no prefix specified', () => {
      expect(standardizeIdentifier('my-identifier')).toBe('my-identifier');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(standardizeIdentifier('')).toBe('');
    });

    it('should handle empty string with prefix', () => {
      expect(standardizeIdentifier('', 'docs')).toBe('docs_');
    });

    it('should handle identifier with only underscore', () => {
      expect(standardizeIdentifier('_')).toBe('');
    });

    it('should handle identifier starting with underscore', () => {
      // '_123' splits to ['', '123'], so [1] returns '123'
      expect(standardizeIdentifier('_123')).toBe('123');
    });

    it('should handle identifier ending with underscore', () => {
      expect(standardizeIdentifier('docs_')).toBe('');
    });

    it('should prioritize extraction over prefix addition when underscore present', () => {
      // Even with prefix parameter, if underscore exists, it extracts
      expect(standardizeIdentifier('docs_123', 'agt')).toBe('123');
    });

    it('should handle UUID-like identifiers', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(standardizeIdentifier(uuid)).toBe(uuid);
      expect(standardizeIdentifier(uuid, 'docs')).toBe(`docs_${uuid}`);
    });

    it('should handle very long identifiers', () => {
      const longId = 'a'.repeat(1000);
      expect(standardizeIdentifier(longId, 'docs')).toBe(`docs_${longId}`);
    });
  });
});
