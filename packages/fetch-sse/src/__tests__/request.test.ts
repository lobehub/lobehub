import { describe, expect, it, vi } from 'vitest';

import { getRequestBody } from '../request';

describe('getRequestBody', () => {
  describe('undefined or null input', () => {
    it('should return undefined when body is undefined', async () => {
      // Arrange & Act
      const result = await getRequestBody(undefined);

      // Assert
      expect(result).toBeUndefined();
    });
  });

  describe('string input', () => {
    it('should return string body as-is', async () => {
      // Arrange
      const body = 'test string body';

      // Act
      const result = await getRequestBody(body);

      // Assert
      expect(result).toBe('test string body');
      expect(typeof result).toBe('string');
    });

    it('should return undefined for empty string (falsy check)', async () => {
      // Arrange
      const body = '';

      // Act
      const result = await getRequestBody(body);

      // Assert
      // Empty string is falsy, so the function returns undefined
      expect(result).toBeUndefined();
    });
  });

  describe('ArrayBuffer input', () => {
    it('should return ArrayBuffer as-is', async () => {
      // Arrange
      const buffer = new ArrayBuffer(8);
      const view = new Uint8Array(buffer);
      view[0] = 65; // 'A'
      view[1] = 66; // 'B'

      // Act
      const result = await getRequestBody(buffer);

      // Assert
      expect(result).toBe(buffer);
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(8);
    });
  });

  describe('ArrayBufferView input (TypedArrays)', () => {
    it('should convert Uint8Array to sliced ArrayBuffer', async () => {
      // Arrange
      const buffer = new ArrayBuffer(16);
      const uint8View = new Uint8Array(buffer, 4, 8); // offset: 4, length: 8
      uint8View[0] = 65;
      uint8View[1] = 66;

      // Act
      const result = await getRequestBody(uint8View);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(8);
      expect(result).not.toBe(buffer); // Should be a new sliced buffer

      // Verify the sliced data
      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(resultView[0]).toBe(65);
      expect(resultView[1]).toBe(66);
    });
    it('should convert DataView to sliced ArrayBuffer', async () => {
      // Arrange
      const buffer = new ArrayBuffer(24);
      const dataView = new DataView(buffer, 8, 8); // offset: 8, length: 8
      dataView.setUint8(0, 65);
      dataView.setUint8(1, 66);

      // Act
      const result = await getRequestBody(dataView);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(8);

      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(resultView[0]).toBe(65);
      expect(resultView[1]).toBe(66);
    });
  });

  describe('Blob input', () => {
    it('should convert Blob to ArrayBuffer', async () => {
      // Arrange
      const blobData = 'test blob content';
      const blob = new Blob([blobData], { type: 'text/plain' });

      // Act
      const result = await getRequestBody(blob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);

      // Verify content
      const decoder = new TextDecoder();
      const text = decoder.decode(result as ArrayBuffer);
      expect(text).toBe('test blob content');
    });
    it('should convert File (subclass of Blob)', async () => {
      // Arrange
      const fileContent = 'file content';
      const file = new File([fileContent], 'test.txt', { type: 'text/plain' });

      // Act
      const result = await getRequestBody(file);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);

      const decoder = new TextDecoder();
      const text = decoder.decode(result as ArrayBuffer);
      expect(text).toBe('file content');
    });
  });

  describe('Unsupported types', () => {
    it('should throw error for FormData', async () => {
      // Arrange
      const formData = new FormData();
      formData.append('key', 'value');

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Act & Assert
      await expect(getRequestBody(formData as any)).rejects.toThrow(
        'Unsupported IPC proxy request body type',
      );

      expect(warnSpy).toHaveBeenCalledWith('Unsupported IPC proxy request body type:', 'object');

      // Cleanup
      warnSpy.mockRestore();
    });
    it('should throw error for plain object', async () => {
      // Arrange
      const obj = { key: 'value' };

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Act & Assert
      await expect(getRequestBody(obj as any)).rejects.toThrow(
        'Unsupported IPC proxy request body type',
      );

      expect(warnSpy).toHaveBeenCalledWith('Unsupported IPC proxy request body type:', 'object');

      // Cleanup
      warnSpy.mockRestore();
    });
  });

  describe('Edge cases', () => {
    it('should handle Uint8Array from actual buffer slice', async () => {
      // Arrange - simulate real-world scenario where buffer is sliced
      const originalBuffer = new ArrayBuffer(100);
      const originalView = new Uint8Array(originalBuffer);
      originalView.fill(42);

      const slicedView = new Uint8Array(originalBuffer, 20, 30);

      // Act
      const result = await getRequestBody(slicedView);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(30);

      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(resultView.every((byte) => byte === 42)).toBe(true);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle JSON API request body', async () => {
      // Arrange
      const apiPayload = JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      });

      // Act
      const result = await getRequestBody(apiPayload);

      // Assert
      expect(typeof result).toBe('string');
      expect(result).toBe(apiPayload);
    });
    it('should handle empty request (no body)', async () => {
      // Arrange & Act
      const result = await getRequestBody();

      // Assert
      expect(result).toBeUndefined();
    });
  });
});
