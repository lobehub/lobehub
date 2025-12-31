import { describe, expect, it, vi } from 'vitest';

import { getRequestBody } from '../request';

describe('getRequestBody', () => {
  describe('undefined or null input', () => {
    it('should return undefined when body is null', async () => {
      // Arrange & Act
      const result = await getRequestBody(null);

      // Assert
      expect(result).toBeUndefined();
    });

    it('should return undefined when body is undefined', async () => {
      // Arrange & Act
      const result = await getRequestBody(undefined);

      // Assert
      expect(result).toBeUndefined();
    });

    it('should return undefined when body is not provided', async () => {
      // Arrange & Act
      const result = await getRequestBody();

      // Assert
      expect(result).toBeUndefined();
    });
  });

  describe('String input', () => {
    it('should return string body as-is', async () => {
      // Arrange
      const stringBody = 'test string body';

      // Act
      const result = await getRequestBody(stringBody);

      // Assert
      expect(result).toBe(stringBody);
      expect(typeof result).toBe('string');
    });

    it('should return undefined for empty string (falsy check)', async () => {
      // Arrange
      const emptyString = '';

      // Act
      const result = await getRequestBody(emptyString);

      // Assert
      // Empty string is falsy, so the function returns undefined
      expect(result).toBeUndefined();
    });

    it('should handle JSON string', async () => {
      // Arrange
      const jsonString = '{"key":"value","number":123}';

      // Act
      const result = await getRequestBody(jsonString);

      // Assert
      expect(result).toBe(jsonString);
      expect(typeof result).toBe('string');
    });

    it('should handle string with special characters', async () => {
      // Arrange
      const specialString = 'Special chars: !@#$%^&*()_+ 你好 🎉';

      // Act
      const result = await getRequestBody(specialString);

      // Assert
      expect(result).toBe(specialString);
    });

    it('should handle multiline string', async () => {
      // Arrange
      const multilineString = 'Line 1\nLine 2\nLine 3';

      // Act
      const result = await getRequestBody(multilineString);

      // Assert
      expect(result).toBe(multilineString);
    });
  });

  describe('ArrayBuffer input', () => {
    it('should return ArrayBuffer as-is', async () => {
      // Arrange
      const buffer = new ArrayBuffer(8);
      const view = new Uint8Array(buffer);
      view[0] = 72; // 'H'
      view[1] = 101; // 'e'
      view[2] = 108; // 'l'
      view[3] = 108; // 'l'
      view[4] = 111; // 'o'

      // Act
      const result = await getRequestBody(buffer);

      // Assert
      expect(result).toBe(buffer);
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(8);
    });

    it('should handle empty ArrayBuffer', async () => {
      // Arrange
      const emptyBuffer = new ArrayBuffer(0);

      // Act
      const result = await getRequestBody(emptyBuffer);

      // Assert
      expect(result).toBe(emptyBuffer);
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(0);
    });

    it('should handle large ArrayBuffer', async () => {
      // Arrange
      const largeBuffer = new ArrayBuffer(1024 * 1024); // 1MB

      // Act
      const result = await getRequestBody(largeBuffer);

      // Assert
      expect(result).toBe(largeBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(1024 * 1024);
    });
  });

  describe('TypedArray input (ArrayBuffer.isView)', () => {
    it('should convert Uint8Array to sliced ArrayBuffer', async () => {
      // Arrange
      const uint8Array = new Uint8Array([1, 2, 3, 4, 5]);

      // Act
      const result = await getRequestBody(uint8Array);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(5);

      // Verify content
      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(Array.from(resultView)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should handle Uint8Array with byteOffset', async () => {
      // Arrange
      const buffer = new ArrayBuffer(10);
      const fullView = new Uint8Array(buffer);
      fullView.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

      // Create a view starting at offset 3, length 4
      const slicedView = new Uint8Array(buffer, 3, 4);

      // Act
      const result = await getRequestBody(slicedView);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(4);

      // Verify it contains the correct slice [3, 4, 5, 6]
      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(Array.from(resultView)).toEqual([3, 4, 5, 6]);
    });

    it('should convert Uint16Array to ArrayBuffer', async () => {
      // Arrange
      const uint16Array = new Uint16Array([256, 512, 1024]);

      // Act
      const result = await getRequestBody(uint16Array);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(6); // 3 * 2 bytes

      // Verify content
      const resultView = new Uint16Array(result as ArrayBuffer);
      expect(Array.from(resultView)).toEqual([256, 512, 1024]);
    });

    it('should convert Int32Array to ArrayBuffer', async () => {
      // Arrange
      const int32Array = new Int32Array([-1, 0, 1, 2147483647]);

      // Act
      const result = await getRequestBody(int32Array);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(16); // 4 * 4 bytes

      // Verify content
      const resultView = new Int32Array(result as ArrayBuffer);
      expect(Array.from(resultView)).toEqual([-1, 0, 1, 2147483647]);
    });

    it('should convert Float32Array to ArrayBuffer', async () => {
      // Arrange
      const float32Array = new Float32Array([1.5, 2.7, 3.14]);

      // Act
      const result = await getRequestBody(float32Array);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(12); // 3 * 4 bytes

      // Verify content (use approximate matching for floating point precision)
      const resultView = new Float32Array(result as ArrayBuffer);
      expect(resultView[0]).toBeCloseTo(1.5, 5);
      expect(resultView[1]).toBeCloseTo(2.7, 5);
      expect(resultView[2]).toBeCloseTo(3.14, 5);
    });

    it('should convert DataView to ArrayBuffer', async () => {
      // Arrange
      const buffer = new ArrayBuffer(4);
      const dataView = new DataView(buffer);
      dataView.setUint8(0, 255);
      dataView.setUint8(1, 128);
      dataView.setUint8(2, 64);
      dataView.setUint8(3, 32);

      // Act
      const result = await getRequestBody(dataView);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(4);

      // Verify content
      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(Array.from(resultView)).toEqual([255, 128, 64, 32]);
    });

    it('should handle empty TypedArray', async () => {
      // Arrange
      const emptyUint8Array = new Uint8Array(0);

      // Act
      const result = await getRequestBody(emptyUint8Array);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(0);
    });

    it('should properly slice when TypedArray has both offset and custom length', async () => {
      // Arrange
      const buffer = new ArrayBuffer(20);
      const fullView = new Uint8Array(buffer);
      fullView.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

      // Create view from byte 5, length 10
      const slicedView = new Uint8Array(buffer, 5, 10);

      // Act
      const result = await getRequestBody(slicedView);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(10);

      // Verify content [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(Array.from(resultView)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    });
  });

  describe('Blob input', () => {
    it('should convert Blob to ArrayBuffer', async () => {
      // Arrange
      const blobContent = 'Hello, Blob!';
      const blob = new Blob([blobContent], { type: 'text/plain' });

      // Act
      const result = await getRequestBody(blob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);

      // Verify content
      const decoder = new TextDecoder();
      const text = decoder.decode(result as ArrayBuffer);
      expect(text).toBe(blobContent);
    });

    it('should handle empty Blob', async () => {
      // Arrange
      const emptyBlob = new Blob([], { type: 'text/plain' });

      // Act
      const result = await getRequestBody(emptyBlob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(0);
    });

    it('should handle Blob with binary data', async () => {
      // Arrange
      const binaryData = new Uint8Array([0, 1, 2, 3, 255, 254, 253]);
      const blob = new Blob([binaryData], { type: 'application/octet-stream' });

      // Act
      const result = await getRequestBody(blob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(7);

      // Verify content
      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(Array.from(resultView)).toEqual([0, 1, 2, 3, 255, 254, 253]);
    });

    it('should handle Blob with JSON data', async () => {
      // Arrange
      const jsonData = { key: 'value', number: 123 };
      const blob = new Blob([JSON.stringify(jsonData)], { type: 'application/json' });

      // Act
      const result = await getRequestBody(blob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);

      // Verify content
      const decoder = new TextDecoder();
      const text = decoder.decode(result as ArrayBuffer);
      expect(JSON.parse(text)).toEqual(jsonData);
    });

    it('should handle Blob with UTF-8 encoded text', async () => {
      // Arrange
      const utf8Text = '你好世界 🌍';
      const blob = new Blob([utf8Text], { type: 'text/plain; charset=utf-8' });

      // Act
      const result = await getRequestBody(blob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);

      // Verify content
      const decoder = new TextDecoder();
      const text = decoder.decode(result as ArrayBuffer);
      expect(text).toBe(utf8Text);
    });

    it('should handle large Blob', async () => {
      // Arrange
      const largeContent = 'x'.repeat(1024 * 100); // 100KB
      const blob = new Blob([largeContent], { type: 'text/plain' });

      // Act
      const result = await getRequestBody(blob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(1024 * 100);
    });
  });

  describe('Unsupported types', () => {
    it('should throw error for unsupported type and log warning', async () => {
      // Arrange
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const unsupportedBody = { object: 'not supported' } as unknown as BodyInit;

      // Act & Assert
      await expect(getRequestBody(unsupportedBody)).rejects.toThrow(
        'Unsupported IPC proxy request body type',
      );

      // Verify console.warn was called
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Unsupported IPC proxy request body type:',
        'object',
      );

      // Cleanup
      consoleWarnSpy.mockRestore();
    });

    it('should throw error for number type', async () => {
      // Arrange
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const numberBody = 123 as unknown as BodyInit;

      // Act & Assert
      await expect(getRequestBody(numberBody)).rejects.toThrow(
        'Unsupported IPC proxy request body type',
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Unsupported IPC proxy request body type:',
        'number',
      );

      // Cleanup
      consoleWarnSpy.mockRestore();
    });

    it('should throw error for boolean type', async () => {
      // Arrange
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const booleanBody = true as unknown as BodyInit;

      // Act & Assert
      await expect(getRequestBody(booleanBody)).rejects.toThrow(
        'Unsupported IPC proxy request body type',
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Unsupported IPC proxy request body type:',
        'boolean',
      );

      // Cleanup
      consoleWarnSpy.mockRestore();
    });

    it('should throw error for array type', async () => {
      // Arrange
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const arrayBody = [1, 2, 3] as unknown as BodyInit;

      // Act & Assert
      await expect(getRequestBody(arrayBody)).rejects.toThrow(
        'Unsupported IPC proxy request body type',
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Unsupported IPC proxy request body type:',
        'object',
      );

      // Cleanup
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical JSON API request body', async () => {
      // Arrange
      const apiPayload = JSON.stringify({
        query: 'search term',
        filters: { category: 'technology' },
        limit: 10,
      });

      // Act
      const result = await getRequestBody(apiPayload);

      // Assert
      expect(result).toBe(apiPayload);
      expect(typeof result).toBe('string');
    });

    it('should handle binary file upload (Blob)', async () => {
      // Arrange
      const fileData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
      const fileBlob = new Blob([fileData], { type: 'image/png' });

      // Act
      const result = await getRequestBody(fileBlob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);

      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(Array.from(resultView)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    });

    it('should handle streaming data chunks (Uint8Array)', async () => {
      // Arrange
      const chunk = new Uint8Array([65, 66, 67, 68, 69]); // "ABCDE"

      // Act
      const result = await getRequestBody(chunk);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);

      const decoder = new TextDecoder();
      const text = decoder.decode(result as ArrayBuffer);
      expect(text).toBe('ABCDE');
    });

    it('should handle form data as string', async () => {
      // Arrange
      const formData = 'username=test&password=secret&remember=true';

      // Act
      const result = await getRequestBody(formData);

      // Assert
      expect(result).toBe(formData);
      expect(typeof result).toBe('string');
    });

    it('should handle empty request (no body)', async () => {
      // Arrange & Act
      const result = await getRequestBody(null);

      // Assert
      expect(result).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle very long string', async () => {
      // Arrange
      const longString = 'a'.repeat(10000);

      // Act
      const result = await getRequestBody(longString);

      // Assert
      expect(result).toBe(longString);
      expect((result as string).length).toBe(10000);
    });

    it('should handle ArrayBuffer with single byte', async () => {
      // Arrange
      const singleByteBuffer = new ArrayBuffer(1);
      const view = new Uint8Array(singleByteBuffer);
      view[0] = 42;

      // Act
      const result = await getRequestBody(singleByteBuffer);

      // Assert
      expect(result).toBe(singleByteBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(1);
    });

    it('should handle string containing only whitespace', async () => {
      // Arrange
      const whitespaceString = '   \n\t\r   ';

      // Act
      const result = await getRequestBody(whitespaceString);

      // Assert
      expect(result).toBe(whitespaceString);
    });

    it('should handle Blob from multiple sources', async () => {
      // Arrange
      const part1 = 'Hello ';
      const part2 = new Uint8Array([87, 111, 114, 108, 100]); // "World"
      const part3 = '!';
      const multiPartBlob = new Blob([part1, part2, part3], { type: 'text/plain' });

      // Act
      const result = await getRequestBody(multiPartBlob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);

      const decoder = new TextDecoder();
      const text = decoder.decode(result as ArrayBuffer);
      expect(text).toBe('Hello World!');
    });
  });
});
