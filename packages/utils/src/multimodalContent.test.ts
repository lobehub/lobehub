import type { MessageContentPart } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { deserializeParts, serializePartsForStorage } from './multimodalContent';

describe('multimodalContent', () => {
  describe('serializePartsForStorage', () => {
    it('should serialize text content part to JSON string', () => {
      const parts: MessageContentPart[] = [
        {
          type: 'text',
          text: 'Hello, world!',
        },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe('[{"type":"text","text":"Hello, world!"}]');
      expect(typeof result).toBe('string');
    });

    it('should serialize image content part to JSON string', () => {
      const parts: MessageContentPart[] = [
        {
          type: 'image',
          image: 'data:image/png;base64,iVBORw0KGgoAAAANS',
        },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe('[{"type":"image","image":"data:image/png;base64,iVBORw0KGgoAAAANS"}]');
    });

    it('should serialize multiple content parts to JSON string', () => {
      const parts: MessageContentPart[] = [
        {
          type: 'text',
          text: 'Check this image:',
        },
        {
          type: 'image',
          image: 'data:image/png;base64,abc123',
        },
        {
          type: 'text',
          text: 'What do you think?',
        },
      ];

      const result = serializePartsForStorage(parts);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].type).toBe('text');
      expect(parsed[1].type).toBe('image');
      expect(parsed[2].type).toBe('text');
    });

    it('should serialize content parts with thoughtSignature', () => {
      const parts: MessageContentPart[] = [
        {
          type: 'text',
          text: 'Reasoning content',
          thoughtSignature: 'sig-123',
        },
      ];

      const result = serializePartsForStorage(parts);
      const parsed = JSON.parse(result);

      expect(parsed[0].thoughtSignature).toBe('sig-123');
    });

    it('should handle empty array', () => {
      const parts: MessageContentPart[] = [];

      const result = serializePartsForStorage(parts);

      expect(result).toBe('[]');
    });

    it('should handle special characters in text', () => {
      const parts: MessageContentPart[] = [
        {
          type: 'text',
          text: 'Hello "world"!\nNew line\tTab\r\nWindows line',
        },
      ];

      const result = serializePartsForStorage(parts);
      const parsed = JSON.parse(result);

      expect(parsed[0].text).toBe('Hello "world"!\nNew line\tTab\r\nWindows line');
    });

    it('should handle unicode characters', () => {
      const parts: MessageContentPart[] = [
        {
          type: 'text',
          text: '你好世界 🌍 مرحبا بالعالم',
        },
      ];

      const result = serializePartsForStorage(parts);
      const parsed = JSON.parse(result);

      expect(parsed[0].text).toBe('你好世界 🌍 مرحبا بالعالم');
    });
  });

  describe('deserializeParts', () => {
    it('should deserialize valid JSON string to content parts', () => {
      const jsonString = '[{"type":"text","text":"Hello, world!"}]';

      const result = deserializeParts(jsonString);

      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result![0].type).toBe('text');
      if (result![0].type === 'text') {
        expect(result![0].text).toBe('Hello, world!');
      }
    });

    it('should deserialize multiple content parts', () => {
      const jsonString =
        '[{"type":"text","text":"Check this:"},{"type":"image","image":"data:image/png"}]';

      const result = deserializeParts(jsonString);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result![0].type).toBe('text');
      expect(result![1].type).toBe('image');
    });

    it('should deserialize content parts with thoughtSignature', () => {
      const jsonString = '[{"type":"text","text":"Reasoning","thoughtSignature":"sig-123"}]';

      const result = deserializeParts(jsonString);

      expect(result).not.toBeNull();
      if (result![0].type === 'text') {
        expect(result![0].thoughtSignature).toBe('sig-123');
      }
    });

    it('should return null for invalid JSON', () => {
      const invalidJSON = '{not valid json}';

      const result = deserializeParts(invalidJSON);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = deserializeParts('');

      expect(result).toBeNull();
    });

    it('should return null for plain text string', () => {
      const plainText = 'Just a plain text message';

      const result = deserializeParts(plainText);

      expect(result).toBeNull();
    });

    it('should return null for empty array', () => {
      const emptyArray = '[]';

      const result = deserializeParts(emptyArray);

      expect(result).toBeNull();
    });

    it('should return null for array without type property', () => {
      const invalidParts = '[{"text":"Hello"}]';

      const result = deserializeParts(invalidParts);

      expect(result).toBeNull();
    });

    it('should return null for non-array JSON', () => {
      const objectJSON = '{"type":"text","text":"Hello"}';

      const result = deserializeParts(objectJSON);

      expect(result).toBeNull();
    });

    it('should return null for array of primitives', () => {
      const primitiveArray = '[1, 2, 3, "text"]';

      const result = deserializeParts(primitiveArray);

      expect(result).toBeNull();
    });

    it('should handle malformed JSON gracefully', () => {
      const malformedJSON = '[{"type":"text","text":}]';

      const result = deserializeParts(malformedJSON);

      expect(result).toBeNull();
    });

    it('should deserialize content with special characters', () => {
      const jsonString = '[{"type":"text","text":"Hello \\"world\\"!\\nNew line"}]';

      const result = deserializeParts(jsonString);

      expect(result).not.toBeNull();
      if (result![0].type === 'text') {
        expect(result![0].text).toBe('Hello "world"!\nNew line');
      }
    });

    it('should deserialize content with unicode characters', () => {
      const jsonString = '[{"type":"text","text":"你好世界 🌍"}]';

      const result = deserializeParts(jsonString);

      expect(result).not.toBeNull();
      if (result![0].type === 'text') {
        expect(result![0].text).toBe('你好世界 🌍');
      }
    });
  });

  describe('round-trip serialization', () => {
    it('should maintain data integrity for text parts', () => {
      const originalParts: MessageContentPart[] = [
        {
          type: 'text',
          text: 'Original text content',
        },
      ];

      const serialized = serializePartsForStorage(originalParts);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(originalParts);
    });

    it('should maintain data integrity for image parts', () => {
      const originalParts: MessageContentPart[] = [
        {
          type: 'image',
          image: 'data:image/png;base64,abc123',
        },
      ];

      const serialized = serializePartsForStorage(originalParts);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(originalParts);
    });

    it('should maintain data integrity for mixed content', () => {
      const originalParts: MessageContentPart[] = [
        {
          type: 'text',
          text: 'Text before image',
          thoughtSignature: 'sig-1',
        },
        {
          type: 'image',
          image: 'data:image/png;base64,xyz789',
        },
        {
          type: 'text',
          text: 'Text after image',
        },
      ];

      const serialized = serializePartsForStorage(originalParts);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(originalParts);
    });

    it('should maintain data integrity for complex text with special characters', () => {
      const originalParts: MessageContentPart[] = [
        {
          type: 'text',
          text: 'Complex text:\n- Line 1\n- "Quoted"\n- Tab:\t<-\n- Unicode: 你好 🌍',
        },
      ];

      const serialized = serializePartsForStorage(originalParts);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(originalParts);
    });
  });
});
