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

    it('should return undefined when body is null', async () => {
      // Arrange & Act
      const result = await getRequestBody(null);

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

    it('should handle JSON string', async () => {
      // Arrange
      const body = JSON.stringify({ key: 'value', number: 123 });

      // Act
      const result = await getRequestBody(body);

      // Assert
      expect(result).toBe('{"key":"value","number":123}');
      expect(typeof result).toBe('string');
    });

    it('should handle string with special characters', async () => {
      // Arrange
      const body = 'test\nstring\twith\rspecial\u0000chars';

      // Act
      const result = await getRequestBody(body);

      // Assert
      expect(result).toBe('test\nstring\twith\rspecial\u0000chars');
    });

    it('should handle very long string', async () => {
      // Arrange
      const body = 'a'.repeat(10000);

      // Act
      const result = await getRequestBody(body);

      // Assert
      expect(result).toBe(body);
      expect(typeof result).toBe('string');
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

    it('should handle empty ArrayBuffer', async () => {
      // Arrange
      const buffer = new ArrayBuffer(0);

      // Act
      const result = await getRequestBody(buffer);

      // Assert
      expect(result).toBe(buffer);
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(0);
    });

    it('should handle large ArrayBuffer', async () => {
      // Arrange
      const buffer = new ArrayBuffer(1024 * 1024); // 1MB

      // Act
      const result = await getRequestBody(buffer);

      // Assert
      expect(result).toBe(buffer);
      expect((result as ArrayBuffer).byteLength).toBe(1024 * 1024);
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

    it('should convert Uint16Array to sliced ArrayBuffer', async () => {
      // Arrange
      const buffer = new ArrayBuffer(32);
      const uint16View = new Uint16Array(buffer, 8, 4); // offset: 8 bytes, length: 4 elements
      uint16View[0] = 256;
      uint16View[1] = 512;

      // Act
      const result = await getRequestBody(uint16View);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(8); // 4 elements * 2 bytes
      expect(result).not.toBe(buffer);

      // Verify data
      const resultView = new Uint16Array(result as ArrayBuffer);
      expect(resultView[0]).toBe(256);
      expect(resultView[1]).toBe(512);
    });

    it('should convert Int32Array to sliced ArrayBuffer', async () => {
      // Arrange
      const buffer = new ArrayBuffer(64);
      const int32View = new Int32Array(buffer, 16, 8); // offset: 16 bytes, length: 8 elements
      int32View[0] = -12345;
      int32View[7] = 67890;

      // Act
      const result = await getRequestBody(int32View);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(32); // 8 elements * 4 bytes
      expect(result).not.toBe(buffer);

      // Verify data
      const resultView = new Int32Array(result as ArrayBuffer);
      expect(resultView[0]).toBe(-12345);
      expect(resultView[7]).toBe(67890);
    });

    it('should convert Float32Array to sliced ArrayBuffer', async () => {
      // Arrange
      const buffer = new ArrayBuffer(40);
      const float32View = new Float32Array(buffer, 4, 5);
      float32View[0] = 3.14159;
      float32View[4] = 2.71828;

      // Act
      const result = await getRequestBody(float32View);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(20); // 5 elements * 4 bytes

      const resultView = new Float32Array(result as ArrayBuffer);
      expect(resultView[0]).toBeCloseTo(3.14159);
      expect(resultView[4]).toBeCloseTo(2.71828);
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

    it('should handle TypedArray with zero offset', async () => {
      // Arrange
      const buffer = new ArrayBuffer(16);
      const uint8View = new Uint8Array(buffer, 0, 16);
      uint8View[0] = 100;

      // Act
      const result = await getRequestBody(uint8View);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(16);

      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(resultView[0]).toBe(100);
    });

    it('should handle empty TypedArray', async () => {
      // Arrange
      const buffer = new ArrayBuffer(16);
      const uint8View = new Uint8Array(buffer, 8, 0); // zero length

      // Act
      const result = await getRequestBody(uint8View);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(0);
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

    it('should convert Blob with binary data', async () => {
      // Arrange
      const uint8Array = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const blob = new Blob([uint8Array], { type: 'application/octet-stream' });

      // Act
      const result = await getRequestBody(blob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);

      const decoder = new TextDecoder();
      const text = decoder.decode(result as ArrayBuffer);
      expect(text).toBe('Hello');
    });

    it('should handle empty Blob', async () => {
      // Arrange
      const blob = new Blob([], { type: 'text/plain' });

      // Act
      const result = await getRequestBody(blob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(0);
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

    it('should handle Blob with multiple chunks', async () => {
      // Arrange
      const blob = new Blob(['chunk1', 'chunk2', 'chunk3'], { type: 'text/plain' });

      // Act
      const result = await getRequestBody(blob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);

      const decoder = new TextDecoder();
      const text = decoder.decode(result as ArrayBuffer);
      expect(text).toBe('chunk1chunk2chunk3');
    });

    it('should handle large Blob', async () => {
      // Arrange
      const largeData = 'x'.repeat(100000);
      const blob = new Blob([largeData], { type: 'text/plain' });

      // Act
      const result = await getRequestBody(blob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect((result as ArrayBuffer).byteLength).toBe(100000);
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

    it('should throw error for URLSearchParams', async () => {
      // Arrange
      const params = new URLSearchParams({ key: 'value' });

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Act & Assert
      await expect(getRequestBody(params as any)).rejects.toThrow(
        'Unsupported IPC proxy request body type',
      );

      expect(warnSpy).toHaveBeenCalledWith('Unsupported IPC proxy request body type:', 'object');

      // Cleanup
      warnSpy.mockRestore();
    });

    it('should throw error for ReadableStream', async () => {
      // Arrange
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('test');
          controller.close();
        },
      });

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Act & Assert
      await expect(getRequestBody(stream as any)).rejects.toThrow(
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

    it('should throw error for number', async () => {
      // Arrange
      const num = 123;

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Act & Assert
      await expect(getRequestBody(num as any)).rejects.toThrow(
        'Unsupported IPC proxy request body type',
      );

      expect(warnSpy).toHaveBeenCalledWith('Unsupported IPC proxy request body type:', 'number');

      // Cleanup
      warnSpy.mockRestore();
    });

    it('should throw error for boolean', async () => {
      // Arrange
      const bool = true;

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Act & Assert
      await expect(getRequestBody(bool as any)).rejects.toThrow(
        'Unsupported IPC proxy request body type',
      );

      expect(warnSpy).toHaveBeenCalledWith('Unsupported IPC proxy request body type:', 'boolean');

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

    it('should preserve binary data integrity through TypedArray conversion', async () => {
      // Arrange
      const buffer = new ArrayBuffer(8);
      const view = new Uint8Array(buffer);
      // Set specific binary pattern
      view[0] = 0xFF;
      view[1] = 0x00;
      view[2] = 0xAA;
      view[3] = 0x55;
      view[4] = 0x12;
      view[5] = 0x34;
      view[6] = 0x56;
      view[7] = 0x78;

      // Act
      const result = await getRequestBody(view);

      // Assert
      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(resultView[0]).toBe(0xFF);
      expect(resultView[1]).toBe(0x00);
      expect(resultView[2]).toBe(0xAA);
      expect(resultView[3]).toBe(0x55);
      expect(resultView[4]).toBe(0x12);
      expect(resultView[5]).toBe(0x34);
      expect(resultView[6]).toBe(0x56);
      expect(resultView[7]).toBe(0x78);
    });

    it('should handle Blob with non-ASCII characters', async () => {
      // Arrange
      const unicodeText = 'Hello 世界 🌍 مرحبا';
      const blob = new Blob([unicodeText], { type: 'text/plain;charset=utf-8' });

      // Act
      const result = await getRequestBody(blob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);

      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(result as ArrayBuffer);
      expect(text).toBe('Hello 世界 🌍 مرحبا');
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

    it('should handle file upload as Blob', async () => {
      // Arrange
      const imageData = new Uint8Array([
        0x89,
        0x50,
        0x4E,
        0x47,
        0x0D,
        0x0A,
        0x1A,
        0x0A, // PNG header
      ]);
      const imageBlob = new Blob([imageData], { type: 'image/png' });

      // Act
      const result = await getRequestBody(imageBlob);

      // Assert
      expect(result).toBeInstanceOf(ArrayBuffer);
      const resultView = new Uint8Array(result as ArrayBuffer);
      expect(resultView[0]).toBe(0x89);
      expect(resultView[1]).toBe(0x50);
      expect(resultView[2]).toBe(0x4E);
      expect(resultView[3]).toBe(0x47);
    });

    it('should handle binary protocol buffer data', async () => {
      // Arrange
      const protobufData = new Uint8Array([
        0x08, 0x96, 0x01, 0x12, 0x05, 0x48, 0x65, 0x6C, 0x6C, 0x6F,
      ]);
      const buffer = protobufData.buffer;

      // Act
      const result = await getRequestBody(buffer);

      // Assert
      expect(result).toBe(buffer);
      expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it('should handle empty request (no body)', async () => {
      // Arrange & Act
      const result = await getRequestBody();

      // Assert
      expect(result).toBeUndefined();
    });
  });
});
