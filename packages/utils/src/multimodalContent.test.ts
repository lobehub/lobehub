import { MessageContentPart } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { deserializeParts, serializePartsForStorage } from './multimodalContent';

describe('multimodalContent', () => {
  describe('serializePartsForStorage', () => {
    it('should serialize text content parts to JSON string', () => {
      const parts: MessageContentPart[] = [
        {
          text: 'Hello, world!',
          type: 'text',
        },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe(JSON.stringify(parts));
      expect(typeof result).toBe('string');
    });

    it('should serialize image content parts to JSON string', () => {
      const parts: MessageContentPart[] = [
        {
          image:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          type: 'image',
        },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe(JSON.stringify(parts));
    });

    it('should serialize mixed content parts (text and image) to JSON string', () => {
      const parts: MessageContentPart[] = [
        {
          text: 'Check out this image:',
          type: 'text',
        },
        {
          image: 'data:image/png;base64,abc123',
          type: 'image',
        },
        {
          text: 'What do you think?',
          type: 'text',
        },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe(JSON.stringify(parts));
      expect(JSON.parse(result)).toEqual(parts);
    });

    it('should serialize content parts with thoughtSignature to JSON string', () => {
      const parts: MessageContentPart[] = [
        {
          text: 'Thinking...',
          thoughtSignature: 'sig-123',
          type: 'text',
        },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe(JSON.stringify(parts));
      expect(JSON.parse(result)[0].thoughtSignature).toBe('sig-123');
    });

    it('should serialize empty array to JSON string', () => {
      const parts: MessageContentPart[] = [];

      const result = serializePartsForStorage(parts);

      expect(result).toBe('[]');
    });

    it('should handle special characters in text content', () => {
      const parts: MessageContentPart[] = [
        {
          text: 'Special chars: "quotes", \\backslash, \n newline, \t tab',
          type: 'text',
        },
      ];

      const result = serializePartsForStorage(parts);
      const parsed = JSON.parse(result);

      expect(parsed[0].text).toBe((parts[0] as { text: string }).text);
    });

    it('should handle unicode characters in text content', () => {
      const parts: MessageContentPart[] = [
        {
          text: 'Unicode: 你好世界 🌍 émojis 🎉',
          type: 'text',
        },
      ];

      const result = serializePartsForStorage(parts);
      const parsed = JSON.parse(result);

      expect(parsed[0].text).toBe('Unicode: 你好世界 🌍 émojis 🎉');
    });
  });

  describe('deserializeParts', () => {
    it('should deserialize valid JSON array of text parts', () => {
      const parts: MessageContentPart[] = [
        {
          text: 'Hello, world!',
          type: 'text',
        },
      ];
      const serialized = JSON.stringify(parts);

      const result = deserializeParts(serialized);

      expect(result).toEqual(parts);
    });

    it('should deserialize valid JSON array of image parts', () => {
      const parts: MessageContentPart[] = [
        {
          image: 'data:image/png;base64,abc123',
          type: 'image',
        },
      ];
      const serialized = JSON.stringify(parts);

      const result = deserializeParts(serialized);

      expect(result).toEqual(parts);
    });

    it('should deserialize mixed content parts (text and image)', () => {
      const parts: MessageContentPart[] = [
        {
          text: 'Check this out:',
          type: 'text',
        },
        {
          image: 'data:image/png;base64,xyz789',
          type: 'image',
        },
      ];
      const serialized = JSON.stringify(parts);

      const result = deserializeParts(serialized);

      expect(result).toEqual(parts);
    });

    it('should deserialize content parts with thoughtSignature', () => {
      const parts: MessageContentPart[] = [
        {
          text: 'Reasoning step',
          thoughtSignature: 'sig-456',
          type: 'text',
        },
      ];
      const serialized = JSON.stringify(parts);

      const result = deserializeParts(serialized);

      expect(result).toEqual(parts);
      expect(result![0].thoughtSignature).toBe('sig-456');
    });

    it('should return null for plain text (not JSON)', () => {
      const plainText = 'This is just plain text, not JSON';

      const result = deserializeParts(plainText);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = deserializeParts('');

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const invalidJson = '{invalid json}';

      const result = deserializeParts(invalidJson);

      expect(result).toBeNull();
    });

    it('should return null for JSON object (not array)', () => {
      const jsonObject = JSON.stringify({ text: 'Hello', type: 'text' });

      const result = deserializeParts(jsonObject);

      expect(result).toBeNull();
    });

    it('should return null for empty JSON array', () => {
      const emptyArray = JSON.stringify([]);

      const result = deserializeParts(emptyArray);

      expect(result).toBeNull();
    });

    it('should return null for JSON array without type property', () => {
      const invalidParts = JSON.stringify([{ text: 'Hello' }]);

      const result = deserializeParts(invalidParts);

      expect(result).toBeNull();
    });

    it('should return null for JSON array with invalid structure', () => {
      const invalidParts = JSON.stringify(['string1', 'string2']);

      const result = deserializeParts(invalidParts);

      expect(result).toBeNull();
    });

    it('should return null for JSON number', () => {
      const jsonNumber = '123';

      const result = deserializeParts(jsonNumber);

      expect(result).toBeNull();
    });

    it('should return null for JSON boolean', () => {
      const jsonBoolean = 'true';

      const result = deserializeParts(jsonBoolean);

      expect(result).toBeNull();
    });

    it('should handle special characters in deserialized text content', () => {
      const parts: MessageContentPart[] = [
        {
          text: 'Special: "quotes", \\backslash, \n newline',
          type: 'text',
        },
      ];
      const serialized = JSON.stringify(parts);

      const result = deserializeParts(serialized);

      expect((result![0] as { text: string }).text).toBe((parts[0] as { text: string }).text);
    });

    it('should handle unicode characters in deserialized text content', () => {
      const parts: MessageContentPart[] = [
        {
          text: 'Unicode: 你好 🌍',
          type: 'text',
        },
      ];
      const serialized = JSON.stringify(parts);

      const result = deserializeParts(serialized);

      expect((result![0] as { text: string }).text).toBe('Unicode: 你好 🌍');
    });

    it('should handle long base64 image data', () => {
      const longBase64 = 'data:image/png;base64,' + 'A'.repeat(10000);
      const parts: MessageContentPart[] = [
        {
          image: longBase64,
          type: 'image',
        },
      ];
      const serialized = JSON.stringify(parts);

      const result = deserializeParts(serialized);

      expect((result![0] as { image: string }).image).toBe(longBase64);
    });
  });

  describe('round-trip serialization', () => {
    it('should maintain data integrity through serialize and deserialize cycle', () => {
      const originalParts: MessageContentPart[] = [
        {
          text: 'First message',
          type: 'text',
        },
        {
          image: 'data:image/png;base64,test123',
          type: 'image',
        },
        {
          text: 'Second message with special chars: "quotes" & symbols',
          thoughtSignature: 'sig-789',
          type: 'text',
        },
      ];

      const serialized = serializePartsForStorage(originalParts);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(originalParts);
    });

    it('should handle multiple round-trips without data loss', () => {
      const originalParts: MessageContentPart[] = [
        {
          text: 'Test content 你好 🎉',
          type: 'text',
        },
      ];

      // First round-trip
      let serialized = serializePartsForStorage(originalParts);
      let deserialized = deserializeParts(serialized);
      expect(deserialized).toEqual(originalParts);

      // Second round-trip
      serialized = serializePartsForStorage(deserialized!);
      deserialized = deserializeParts(serialized);
      expect(deserialized).toEqual(originalParts);

      // Third round-trip
      serialized = serializePartsForStorage(deserialized!);
      deserialized = deserializeParts(serialized);
      expect(deserialized).toEqual(originalParts);
    });
  });
});
