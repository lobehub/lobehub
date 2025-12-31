import { MessageContentPart } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { deserializeParts, serializePartsForStorage } from './multimodalContent';

describe('multimodalContent', () => {
  describe('serializePartsForStorage', () => {
    it('should serialize text content parts to JSON string', () => {
      const parts: MessageContentPart[] = [{ type: 'text', text: 'Hello, world!' }];

      const result = serializePartsForStorage(parts);

      expect(result).toBe('[{"type":"text","text":"Hello, world!"}]');
    });

    it('should serialize image content parts to JSON string', () => {
      const parts: MessageContentPart[] = [
        { type: 'image', image: 'data:image/png;base64,abc123' },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe('[{"type":"image","image":"data:image/png;base64,abc123"}]');
    });

    it('should serialize mixed content parts to JSON string', () => {
      const parts: MessageContentPart[] = [
        { type: 'text', text: 'Check this image:' },
        { type: 'image', image: 'data:image/png;base64,xyz789' },
        { type: 'text', text: 'What do you think?' },
      ];

      const result = serializePartsForStorage(parts);
      const parsed = JSON.parse(result);

      expect(parsed).toHaveLength(3);
      expect(parsed[0]).toEqual({ type: 'text', text: 'Check this image:' });
      expect(parsed[1]).toEqual({ type: 'image', image: 'data:image/png;base64,xyz789' });
      expect(parsed[2]).toEqual({ type: 'text', text: 'What do you think?' });
    });

    it('should serialize empty array to JSON string', () => {
      const parts: MessageContentPart[] = [];

      const result = serializePartsForStorage(parts);

      expect(result).toBe('[]');
    });

    it('should serialize content parts with thoughtSignature', () => {
      const parts: MessageContentPart[] = [
        { type: 'text', text: 'Thinking...', thoughtSignature: 'reasoning-v1' },
      ];

      const result = serializePartsForStorage(parts);
      const parsed = JSON.parse(result);

      expect(parsed[0]).toEqual({
        type: 'text',
        text: 'Thinking...',
        thoughtSignature: 'reasoning-v1',
      });
    });

    it('should handle special characters in text', () => {
      const parts: MessageContentPart[] = [
        { type: 'text', text: 'Special chars: "quotes", \'apostrophes\', \n newlines' },
      ];

      const result = serializePartsForStorage(parts);
      const parsed = JSON.parse(result);

      expect(parsed[0].text).toBe('Special chars: "quotes", \'apostrophes\', \n newlines');
    });
  });

  describe('deserializeParts', () => {
    it('should deserialize valid JSON array of text parts', () => {
      const content = '[{"type":"text","text":"Hello, world!"}]';

      const result = deserializeParts(content);

      expect(result).toEqual([{ type: 'text', text: 'Hello, world!' }]);
    });

    it('should deserialize valid JSON array of image parts', () => {
      const content = '[{"type":"image","image":"data:image/png;base64,abc123"}]';

      const result = deserializeParts(content);

      expect(result).toEqual([{ type: 'image', image: 'data:image/png;base64,abc123' }]);
    });

    it('should deserialize mixed content parts', () => {
      const content =
        '[{"type":"text","text":"Check this:"},{"type":"image","image":"data:image/png;base64,xyz"}]';

      const result = deserializeParts(content);

      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({ type: 'text', text: 'Check this:' });
      expect(result![1]).toEqual({ type: 'image', image: 'data:image/png;base64,xyz' });
    });

    it('should return null for plain text content', () => {
      const content = 'This is just plain text';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const content = '{invalid json}';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const content = '';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for JSON object (not array)', () => {
      const content = '{"type":"text","text":"Hello"}';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for empty JSON array', () => {
      const content = '[]';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for JSON array without type property', () => {
      const content = '[{"text":"Hello"}]';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should deserialize parts with thoughtSignature', () => {
      const content = '[{"type":"text","text":"Thinking...","thoughtSignature":"reasoning-v1"}]';

      const result = deserializeParts(content);

      expect(result).toEqual([
        { type: 'text', text: 'Thinking...', thoughtSignature: 'reasoning-v1' },
      ]);
    });

    it('should handle JSON with extra whitespace', () => {
      const content = '  [  {  "type"  :  "text"  ,  "text"  :  "Hello"  }  ]  ';

      const result = deserializeParts(content);

      expect(result).toEqual([{ type: 'text', text: 'Hello' }]);
    });

    it('should handle malformed JSON gracefully', () => {
      const content = '[{"type":"text","text":"Hello"';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });
  });

  describe('round-trip serialization', () => {
    it('should correctly serialize and deserialize text parts', () => {
      const original: MessageContentPart[] = [{ type: 'text', text: 'Hello, world!' }];

      const serialized = serializePartsForStorage(original);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(original);
    });

    it('should correctly serialize and deserialize image parts', () => {
      const original: MessageContentPart[] = [
        { type: 'image', image: 'data:image/png;base64,abc123' },
      ];

      const serialized = serializePartsForStorage(original);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(original);
    });

    it('should correctly serialize and deserialize mixed parts', () => {
      const original: MessageContentPart[] = [
        { type: 'text', text: 'Look at this:' },
        { type: 'image', image: 'data:image/png;base64,xyz' },
        { type: 'text', text: 'Amazing!', thoughtSignature: 'v1' },
      ];

      const serialized = serializePartsForStorage(original);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(original);
    });

    it('should handle complex text with special characters', () => {
      const original: MessageContentPart[] = [
        {
          type: 'text',
          text: 'Complex text with\n"quotes"\n\'apostrophes\'\nand unicode: 你好 🎉',
        },
      ];

      const serialized = serializePartsForStorage(original);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(original);
    });
  });
});
