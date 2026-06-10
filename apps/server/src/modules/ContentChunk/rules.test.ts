import { describe, expect, it } from 'vitest';

import { ChunkingRuleParser } from './rules';

describe('ChunkingRuleParser', () => {
  describe('parse', () => {
    it('should parse a single file type rule correctly', () => {
      const input = 'pdf=unstructured,default';
      const result = ChunkingRuleParser.parse(input);

      expect(result).toEqual({
        pdf: ['unstructured', 'default'],
      });
    });

    it('should parse multiple file type rules correctly', () => {
      const input = 'pdf=unstructured,default;doc=doc2x,default;txt=default';
      const result = ChunkingRuleParser.parse(input);

      expect(result).toEqual({
        pdf: ['unstructured', 'default'],
        doc: ['doc2x', 'default'],
        txt: ['default'],
      });
    });

    it('should convert file types to lowercase', () => {
      const input = 'PDF=unstructured;DOC=doc2x';
      const result = ChunkingRuleParser.parse(input);

      expect(result).toEqual({
        pdf: ['unstructured'],
        doc: ['doc2x'],
      });
    });

    it('should filter out invalid service names', () => {
      const input = 'pdf=unstructured,invalid,default,wrongservice';
      const result = ChunkingRuleParser.parse(input);

      expect(result).toEqual({
        pdf: ['unstructured', 'default'],
      });
    });

    it('should handle empty string input', () => {
      const input = '';
      const result = ChunkingRuleParser.parse(input);

      expect(result).toEqual({});
    });

    it('should skip invalid rule formats', () => {
      const input = 'pdf=unstructured;invalid;doc=doc2x;=default;txt';
      const result = ChunkingRuleParser.parse(input);

      expect(result).toEqual({
        pdf: ['unstructured'],
        doc: ['doc2x'],
      });
    });

    it('should handle whitespace in service names', () => {
      const input = 'pdf= unstructured , default ;doc=doc2x';
      const result = ChunkingRuleParser.parse(input);

      expect(result).toEqual({
        pdf: ['unstructured', 'default'],
        doc: ['doc2x'],
      });
    });

    it('should handle duplicate services for same file type', () => {
      const input = 'pdf=unstructured,default,unstructured';
      const result = ChunkingRuleParser.parse(input);

      expect(result).toEqual({
        pdf: ['unstructured', 'default', 'unstructured'],
      });
    });
  });
});
