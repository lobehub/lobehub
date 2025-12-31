import { describe, expect, it } from 'vitest';

import { deserializeParts, serializePartsForStorage } from './multimodalContent';

describe('multimodalContent', () => {
  describe('serializePartsForStorage', () => {
    it('should serialize text content parts to JSON string', () => {
      const parts = [
        { type: 'text' as const, text: 'Hello world' },
        { type: 'text' as const, text: 'Second message' },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe(JSON.stringify(parts));
      expect(typeof result).toBe('string');
    });

    it('should serialize image content parts to JSON string', () => {
      const parts = [{ type: 'image' as const, image: 'data:image/png;base64,abc123' }];

      const result = serializePartsForStorage(parts);

      expect(result).toBe(JSON.stringify(parts));
    });

    it('should serialize mixed content parts to JSON string', () => {
      const parts = [
        { type: 'text' as const, text: 'Check this image:' },
        { type: 'image' as const, image: 'data:image/png;base64,xyz789' },
        { type: 'text' as const, text: 'What do you think?' },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe(JSON.stringify(parts));
    });

    it('should serialize parts with thoughtSignature', () => {
      const parts = [
        {
          type: 'text' as const,
          text: 'Analyzing image...',
          thoughtSignature: 'internal-reasoning',
        },
      ];

      const result = serializePartsForStorage(parts);

      expect(result).toBe(JSON.stringify(parts));
      expect(result).toContain('thoughtSignature');
    });

    it('should handle empty array', () => {
      const parts: any[] = [];

      const result = serializePartsForStorage(parts);

      expect(result).toBe('[]');
    });

    it('should serialize single part correctly', () => {
      const parts = [{ type: 'text' as const, text: 'Single message' }];

      const result = serializePartsForStorage(parts);
      const parsed = JSON.parse(result);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].text).toBe('Single message');
    });
  });

  describe('deserializeParts', () => {
    it('should deserialize valid JSON array of text parts', () => {
      const content = JSON.stringify([
        { type: 'text', text: 'Hello world' },
        { type: 'text', text: 'Second message' },
      ]);

      const result = deserializeParts(content);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result![0].type).toBe('text');
      expect(result![0]).toHaveProperty('text', 'Hello world');
    });

    it('should deserialize valid JSON array of image parts', () => {
      const content = JSON.stringify([{ type: 'image', image: 'data:image/png;base64,abc123' }]);

      const result = deserializeParts(content);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].type).toBe('image');
      expect(result![0]).toHaveProperty('image');
    });

    it('should deserialize mixed content parts', () => {
      const content = JSON.stringify([
        { type: 'text', text: 'Check this:' },
        { type: 'image', image: 'data:image/png;base64,xyz789' },
        { type: 'text', text: 'What do you see?' },
      ]);

      const result = deserializeParts(content);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(3);
      expect(result![0].type).toBe('text');
      expect(result![1].type).toBe('image');
      expect(result![2].type).toBe('text');
    });

    it('should deserialize parts with thoughtSignature', () => {
      const content = JSON.stringify([
        {
          type: 'text',
          text: 'Reasoning...',
          thoughtSignature: 'internal',
        },
      ]);

      const result = deserializeParts(content);

      expect(result).not.toBeNull();
      expect(result![0]).toHaveProperty('thoughtSignature', 'internal');
    });

    it('should return null for plain text (not JSON)', () => {
      const content = 'This is just plain text, not JSON';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const content = '';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const content = '{invalid json}';

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for JSON that is not an array', () => {
      const content = JSON.stringify({ type: 'text', text: 'Not an array' });

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for empty JSON array', () => {
      const content = JSON.stringify([]);

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for array without type property', () => {
      const content = JSON.stringify([{ text: 'Missing type property' }]);

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for array with null first element', () => {
      const content = JSON.stringify([null, { type: 'text', text: 'valid' }]);

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should return null for array with undefined first element', () => {
      const content = JSON.stringify([undefined, { type: 'text', text: 'valid' }]);

      const result = deserializeParts(content);

      expect(result).toBeNull();
    });

    it('should handle JSON with whitespace', () => {
      const content = `
        [
          { "type": "text", "text": "Hello" }
        ]
      `;

      const result = deserializeParts(content);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
    });
  });

  describe('round-trip serialization', () => {
    it('should correctly serialize and deserialize text parts', () => {
      const original = [
        { type: 'text' as const, text: 'First message' },
        { type: 'text' as const, text: 'Second message' },
      ];

      const serialized = serializePartsForStorage(original);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(original);
    });

    it('should correctly serialize and deserialize image parts', () => {
      const original = [{ type: 'image' as const, image: 'data:image/png;base64,test123' }];

      const serialized = serializePartsForStorage(original);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(original);
    });

    it('should correctly serialize and deserialize mixed parts', () => {
      const original = [
        { type: 'text' as const, text: 'Look at this:' },
        { type: 'image' as const, image: 'data:image/jpeg;base64,img456' },
        { type: 'text' as const, text: 'Amazing, right?' },
      ];

      const serialized = serializePartsForStorage(original);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(original);
    });

    it('should correctly serialize and deserialize parts with thoughtSignature', () => {
      const original = [
        {
          type: 'text' as const,
          text: 'Thinking...',
          thoughtSignature: 'reasoning-step-1',
        },
        {
          type: 'image' as const,
          image: 'data:image/png;base64,abc',
          thoughtSignature: 'visual-analysis',
        },
      ];

      const serialized = serializePartsForStorage(original);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(original);
    });

    it('should handle complex multimodal content', () => {
      const original = [
        { type: 'text' as const, text: 'Here are multiple images:' },
        { type: 'image' as const, image: 'data:image/png;base64,img1' },
        { type: 'image' as const, image: 'data:image/png;base64,img2' },
        { type: 'text' as const, text: 'And here is a conclusion' },
        {
          type: 'text' as const,
          text: 'With reasoning',
          thoughtSignature: 'final-thought',
        },
      ];

      const serialized = serializePartsForStorage(original);
      const deserialized = deserializeParts(serialized);

      expect(deserialized).toEqual(original);
      expect(deserialized).toHaveLength(5);
    });
  });
});
