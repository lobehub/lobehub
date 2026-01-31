import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Compressor, StrCompressor } from './compass';

// Mock brotli-wasm module
vi.mock('brotli-wasm', () => {
  // Use Node.js zlib for actual compression in tests
  const zlib = require('node:zlib');

  const mockBrotli = {
    compress: (data: Uint8Array) => {
      // Use Node.js brotli compression
      const buffer = Buffer.from(data);
      const compressed = zlib.brotliCompressSync(buffer);
      return new Uint8Array(compressed);
    },
    decompress: (data: Uint8Array) => {
      // Use Node.js brotli decompression
      const buffer = Buffer.from(data);
      const decompressed = zlib.brotliDecompressSync(buffer);
      return new Uint8Array(decompressed);
    },
  };

  return {
    default: Promise.resolve(mockBrotli),
  };
});

describe('StrCompressor', () => {
  let compressor: StrCompressor;

  beforeEach(async () => {
    compressor = new StrCompressor();
    await compressor.init();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const newCompressor = new StrCompressor();
      await expect(newCompressor.init()).resolves.toBeUndefined();
    });
  });

  describe('compress and decompress (sync)', () => {
    it('should compress and decompress simple string correctly', () => {
      const input = 'Hello, World!';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
      expect(compressed).not.toBe(input);
      expect(compressed.length).toBeLessThan(input.length + 50); // Allowing overhead for small strings
    });

    it('should compress and decompress empty string', () => {
      const input = '';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should compress and decompress long strings efficiently', () => {
      const input = 'Lorem ipsum dolor sit amet, '.repeat(100);
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
      expect(compressed.length).toBeLessThan(input.length); // Should be compressed
    });

    it('should compress and decompress unicode characters', () => {
      const input = '你好世界 🌍 مرحبا بالعالم';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should compress and decompress special characters', () => {
      const input = '!@#$%^&*()_+-=[]{}|;:",.<>?/~`';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should compress and decompress JSON strings', () => {
      const input = JSON.stringify({
        name: 'test',
        nested: { array: [1, 2, 3], value: true },
      });
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
      expect(JSON.parse(decompressed)).toEqual(JSON.parse(input));
    });

    it('should compress and decompress strings with newlines and tabs', () => {
      const input = 'Line 1\nLine 2\n\tIndented\n\t\tDouble indented';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should produce URL-safe compressed strings', () => {
      const input = 'Test string for URL safety';
      const compressed = compressor.compress(input);

      // Should not contain URL-unsafe characters (original + and /)
      expect(compressed).not.toContain('+');
      expect(compressed).not.toMatch(/\/(?!_)/); // Forward slash not followed by underscore
      expect(compressed).not.toContain('='); // Should strip padding
    });
  });

  describe('compressAsync and decompressAsync', () => {
    it('should compress and decompress simple string asynchronously', async () => {
      const input = 'Hello, Async World!';
      const compressed = await compressor.compressAsync(input);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(input);
      expect(compressed).not.toBe(input);
    });

    it('should compress and decompress empty string asynchronously', async () => {
      const input = '';
      const compressed = await compressor.compressAsync(input);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(input);
    });

    it('should compress and decompress long strings asynchronously', async () => {
      const input = 'Async test content. '.repeat(200);
      const compressed = await compressor.compressAsync(input);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(input);
      expect(compressed.length).toBeLessThan(input.length);
    });

    it('should compress and decompress unicode asynchronously', async () => {
      const input = '異步測試 🚀 اختبار غير متزامن';
      const compressed = await compressor.compressAsync(input);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(input);
    });

    it('should produce URL-safe compressed strings asynchronously', async () => {
      const input = 'Async URL safety test';
      const compressed = await compressor.compressAsync(input);

      expect(compressed).not.toContain('+');
      expect(compressed).not.toMatch(/\/(?!_)/);
      expect(compressed).not.toContain('=');
    });
  });

  describe('sync and async method compatibility', () => {
    it('should produce same results for sync and async compress', async () => {
      const input = 'Compatibility test string';
      const syncCompressed = compressor.compress(input);
      const asyncCompressed = await compressor.compressAsync(input);

      expect(syncCompressed).toBe(asyncCompressed);
    });

    it('should decompress async-compressed string with sync method', async () => {
      const input = 'Cross-method test';
      const asyncCompressed = await compressor.compressAsync(input);
      const syncDecompressed = compressor.decompress(asyncCompressed);

      expect(syncDecompressed).toBe(input);
    });

    it('should decompress sync-compressed string with async method', async () => {
      const input = 'Cross-method test 2';
      const syncCompressed = compressor.compress(input);
      const asyncDecompressed = await compressor.decompressAsync(syncCompressed);

      expect(asyncDecompressed).toBe(input);
    });
  });

  describe('round-trip testing with various inputs', () => {
    const testCases = [
      'Simple text',
      'Text with numbers 12345',
      'Special chars: !@#$%^&*()',
      'Unicode: 你好 مرحبا שלום',
      'Emojis: 😀😁😂🤣😃😄',
      'Mixed: Hello世界123!@#',
      'Newlines:\nand\ntabs:\t\there',
      JSON.stringify({ complex: 'object', with: ['arrays', 123, true] }),
      'A'.repeat(1000), // Long repetitive string
      'abcdefghijklmnopqrstuvwxyz'.repeat(50), // Long non-repetitive
      '', // Empty string
      ' ', // Single space
      '\n', // Single newline
    ];

    testCases.forEach((input) => {
      it(`should preserve data through encode/decode cycle: "${input.slice(0, 50)}${input.length > 50 ? '...' : ''}"`, () => {
        const compressed = compressor.compress(input);
        const decompressed = compressor.decompress(compressed);
        expect(decompressed).toBe(input);
      });
    });
  });

  describe('compression efficiency', () => {
    it('should compress repetitive content significantly', () => {
      const input = 'repeat '.repeat(500);
      const compressed = compressor.compress(input);

      // Repetitive content should compress well (at least 50% reduction)
      expect(compressed.length).toBeLessThan(input.length * 0.5);
    });

    it('should handle already compressed/random data', () => {
      // Simulate random data that doesn't compress well
      const input = Array.from({ length: 100 }, () => Math.random().toString(36).slice(2)).join('');
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
      // Random data may not compress much, but should still work
    });
  });

  describe('URL-safe encoding edge cases', () => {
    it('should handle strings that encode to base64 with + character', () => {
      // These specific strings are known to produce + in standard base64
      const inputs = ['?>>', '???', 'foo:bar:baz'];

      inputs.forEach((input) => {
        const compressed = compressor.compress(input);
        expect(compressed).not.toContain('+');

        const decompressed = compressor.decompress(compressed);
        expect(decompressed).toBe(input);
      });
    });

    it('should handle strings that encode to base64 with / character', () => {
      // These strings produce / in standard base64
      const inputs = ['?>?', '?>>>', 'test/path'];

      inputs.forEach((input) => {
        const compressed = compressor.compress(input);
        expect(compressed).not.toMatch(/\/(?!_)/);

        const decompressed = compressor.decompress(compressed);
        expect(decompressed).toBe(input);
      });
    });

    it('should handle strings that encode to base64 with padding', () => {
      // Different lengths to test padding scenarios
      const inputs = ['a', 'ab', 'abc', 'abcd', 'abcde'];

      inputs.forEach((input) => {
        const compressed = compressor.compress(input);
        expect(compressed).not.toContain('=');

        const decompressed = compressor.decompress(compressed);
        expect(decompressed).toBe(input);
      });
    });
  });

  describe('Compressor singleton instance', () => {
    it('should export a pre-initialized Compressor instance', () => {
      expect(Compressor).toBeInstanceOf(StrCompressor);
    });

    it('should be able to use the singleton without explicit init', async () => {
      // Give it time to initialize if needed
      await new Promise((resolve) => setTimeout(resolve, 100));

      const input = 'Test with singleton';
      // This might fail if not initialized, but async methods should work
      const compressed = await Compressor.compressAsync(input);
      const decompressed = await Compressor.decompressAsync(compressed);

      expect(decompressed).toBe(input);
    });
  });

  describe('error handling', () => {
    it('should handle decompression of invalid compressed string gracefully', () => {
      // Invalid base64 or corrupted data
      expect(() => {
        compressor.decompress('invalid-compressed-data!!!');
      }).toThrow();
    });

    it('should handle decompression of empty string', () => {
      // Decompressing empty compressed string should throw an error
      // because empty string is not valid compressed data
      expect(() => {
        compressor.decompress('');
      }).toThrow();
    });
  });

  describe('large payload handling', () => {
    it('should handle very large strings', () => {
      const largeInput = 'Large payload content. '.repeat(10000);
      const compressed = compressor.compress(largeInput);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(largeInput);
      expect(compressed.length).toBeLessThan(largeInput.length);
    });

    it('should handle very large strings asynchronously', async () => {
      const largeInput = 'Async large payload. '.repeat(10000);
      const compressed = await compressor.compressAsync(largeInput);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(largeInput);
      expect(compressed.length).toBeLessThan(largeInput.length);
    });
  });
});
