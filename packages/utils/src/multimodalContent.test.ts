import { describe, expect, it } from 'vitest';

import { deserializeParts, serializePartsForStorage } from './multimodalContent';

describe('multimodalContent', () => {
  describe('serializePartsForStorage', () => {
    it('should serialize text content part to JSON string', () => {
      const parts = [{ type: 'text' as const, text: 'Hello world' }];

      const result = serializePartsForStorage(parts);

      expect(result).toBe('[{"type":"text","text":"Hello world"}]');
    });

    it('should serialize image content part to JSON string', () => {
      const parts = [{ type: 'image' as const, image: 'data:image/png;base64,abc123' }];

      const result = serializePartsForStorage(parts);

      expect(result).toBe('[{"type":"image","image":"data:image/png;base64,abc123"}]');
    });

    it('should serialize multiple content parts to JSON string', () => {
      const parts = [
        { type: 'text' as const, text: 'Check this image:' },
        { type: 'image' as const, image: 'data:image/png;base64,xyz789' },
        { type: 'text' as const, text: 'What do you think?' },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe(
        '[{"type":"text","text":"Check this image:"},{"type":"image","image":"data:image/png;base64,xyz789"},{"type":"text","text":"What do you think?"}]',
      );
    });

    it('should serialize content parts with thoughtSignature', () => {
      const parts = [
        { type: 'text' as const, text: 'Reasoning step', thoughtSignature: 'thought-123' },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe(
        '[{"type":"text","text":"Reasoning step","thoughtSignature":"thought-123"}]',
      );
    });

    it('should handle empty array', () => {
      const parts: any[] = [];

      const result = serializePartsForStorage(parts);

      expect(result).toBe('[]');
    });

    it('should handle special characters in text', () => {
      const parts = [{ type: 'text' as const, text: 'Text with "quotes" and \n newlines \t tabs' }];

      const result = serializePartsForStorage(parts);

      expect(result).toBe(
        '[{"type":"text","text":"Text with \\"quotes\\" and \\n newlines \\t tabs"}]',
      );
    });
  });

  describe('deserializeParts', () => {
    it('should deserialize valid JSON string with text part', () => {
      const content = '[{"type":"text","text":"Hello world"}]';

      const result = deserializeParts(content);

      expect(result).toEqual([{ type: 'text', text: 'Hello world' }]);
    });

    it('should deserialize valid JSON string with image part', () => {
      const content = '[{"type":"image","image":"data:image/png;base64,abc123"}]';

      const result = deserializeParts(content);

      expect(result).toEqual([{ type: 'image', image: 'data:image/png;base64,abc123' }]);
    });

    it('should deserialize valid JSON string with multiple parts', () => {
      const content =
        '[{"type":"text","text":"Check this:"},{"type":"image","image":"data:image/png;base64,xyz"}]';

      const result = deserializeParts(content);

      expect(result).toEqual([
        { type: 'text', text: 'Check this:' },
        { type: 'image', image: 'data:image/png;base64,xyz' },
      ]);
    });

    it('should deserialize parts with thoughtSignature', () => {
      const content = '[{"type":"text","text":"Reasoning","thoughtSignature":"thought-123"}]';

      const result = deserializeParts(content);

      expect(result).toEqual([
        { type: 'text', text: 'Reasoning', thoughtSignature: 'thought-123' },
      ]);
    });

    it('should return null for plain text string (not JSON)', () => {
      const content = 'Just plain text';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const content = '{invalid json}';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for empty array', () => {
      const content = '[]';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for JSON array without type field', () => {
      const content = '[{"text":"Missing type field"}]';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for JSON object (not array)', () => {
      const content = '{"type":"text","text":"Should be array"}';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for JSON string', () => {
      const content = '"just a string"';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for JSON number', () => {
      const content = '123';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for JSON boolean', () => {
      const content = 'true';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for JSON null', () => {
      const content = 'null';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should handle array with null type field', () => {
      const content = '[{"type":null,"text":"Null type"}]';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should handle array with undefined type field', () => {
      const content = '[{"text":"Undefined type"}]';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should handle array with empty string type', () => {
      const content = '[{"type":"","text":"Empty type"}]';

      const result = deserializeParts(content);

      // Empty string is falsy, so should return null
      expect(result).toBeNull();
    });

    it('should successfully deserialize array with valid type (even if just one char)', () => {
      const content = '[{"type":"x","text":"Single char type"}]';

      const result = deserializeParts(content);

      expect(result).toEqual([{ type: 'x', text: 'Single char type' }]);
    });

    it('should handle special characters in deserialized text', () => {
      const content = '[{"type":"text","text":"Text with \\"quotes\\" and \\n newlines"}]';

      const result = deserializeParts(content);

      expect(result).toEqual([{ type: 'text', text: 'Text with "quotes" and \n newlines' }]);
    });

    it('should handle empty string input', () => {
      const content = '';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });
  });

  describe('roundtrip serialization', () => {
    it('should successfully roundtrip text parts', () => {
      const originalParts = [
        { type: 'text' as const, text: 'First message' },
        { type: 'text' as const, text: 'Second message' },
      ];

      const serialized = serializePartsForStorage(originalParts);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(originalParts);
    });

    it('should successfully roundtrip image parts', () => {
      const originalParts = [
        { type: 'image' as const, image: 'data:image/png;base64,abc' },
        { type: 'image' as const, image: 'data:image/jpeg;base64,xyz' },
      ];

      const serialized = serializePartsForStorage(originalParts);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(originalParts);
    });

    it('should successfully roundtrip mixed parts', () => {
      const originalParts = [
        { type: 'text' as const, text: 'Introduction' },
        { type: 'image' as const, image: 'data:image/png;base64,img1' },
        { type: 'text' as const, text: 'Explanation', thoughtSignature: 'thought-1' },
        { type: 'image' as const, image: 'data:image/png;base64,img2' },
      ];

      const serialized = serializePartsForStorage(originalParts);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(originalParts);
    });

    it('should successfully roundtrip parts with complex text content', () => {
      const originalParts = [
        {
          type: 'text' as const,
          text: 'Complex text with:\n- newlines\n- "quotes"\n- special chars: @#$%^&*()\n- unicode: 你好 🎉',
        },
      ];

      const serialized = serializePartsForStorage(originalParts);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(originalParts);
    });
  });
});
