import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Compressor, StrCompressor } from './compass';

// Mock brotli-wasm to avoid WASM loading issues in test environment
vi.mock('brotli-wasm', () => {
  // Simple implementation using zlib for testing purposes
  const zlib = require('zlib');

  const mockBrotli = {
    compress: (buf: Uint8Array) => {
      const compressed = zlib.brotliCompressSync(Buffer.from(buf));
      return new Uint8Array(compressed);
    },
    decompress: (buf: Uint8Array) => {
      const decompressed = zlib.brotliDecompressSync(Buffer.from(buf));
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

  describe('compress and decompress', () => {
    it('should compress and decompress a simple string', () => {
      const input = 'Hello, World!';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(compressed).not.toBe(input);
      expect(typeof compressed).toBe('string');
      expect(decompressed).toBe(input);
    });

    it('should compress and decompress an empty string', () => {
      const input = '';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should compress and decompress a long string efficiently', () => {
      const input = 'a'.repeat(1000);
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(compressed.length).toBeLessThan(input.length);
      expect(decompressed).toBe(input);
    });

    it('should handle special characters', () => {
      const input = '!@#$%^&*()_+-={}[]|\\:";\'<>?,./~`';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should handle unicode characters', () => {
      const input = '你好世界 🌍 مرحبا בעולם Привет';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should handle JSON strings', () => {
      const input = JSON.stringify({
        name: 'John',
        age: 30,
        city: 'New York',
        nested: { foo: 'bar' },
      });
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
      expect(JSON.parse(decompressed)).toEqual(JSON.parse(input));
    });

    it('should handle newlines and tabs', () => {
      const input = 'Line 1\nLine 2\n\tTabbed\r\nCarriage return';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should compress repetitive data efficiently', () => {
      const input = 'repeat '.repeat(100);
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      // Brotli should compress repetitive data very well
      expect(compressed.length).toBeLessThan(input.length / 5);
      expect(decompressed).toBe(input);
    });

    it('should handle strings with mixed content', () => {
      const input = `
        const code = "console.log('hello')";
        const data = { value: 123, text: "test" };
        const unicode = "测试 🎉";
      `;
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });
  });

  describe('compressAsync and decompressAsync', () => {
    it('should compress and decompress asynchronously', async () => {
      const input = 'Async test string';
      const compressed = await compressor.compressAsync(input);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(compressed).not.toBe(input);
      expect(decompressed).toBe(input);
    });

    it('should handle empty string asynchronously', async () => {
      const input = '';
      const compressed = await compressor.compressAsync(input);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(input);
    });

    it('should handle large data asynchronously', async () => {
      const input = 'Large data '.repeat(1000);
      const compressed = await compressor.compressAsync(input);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(compressed.length).toBeLessThan(input.length);
      expect(decompressed).toBe(input);
    });

    it('should handle unicode characters asynchronously', async () => {
      const input = '中文测试 🚀 тест';
      const compressed = await compressor.compressAsync(input);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(input);
    });

    it('should work without calling init first', async () => {
      const newCompressor = new StrCompressor();
      const input = 'Test without init';
      const compressed = await newCompressor.compressAsync(input);
      const decompressed = await newCompressor.decompressAsync(compressed);

      expect(decompressed).toBe(input);
    });

    it('should produce same result as sync methods', async () => {
      const input = 'Compare sync and async';
      const syncCompressed = compressor.compress(input);
      const asyncCompressed = await compressor.compressAsync(input);

      // Both should decompress to the same value
      const syncDecompressed = compressor.decompress(syncCompressed);
      const asyncDecompressed = await compressor.decompressAsync(asyncCompressed);

      expect(syncDecompressed).toBe(input);
      expect(asyncDecompressed).toBe(input);
    });
  });

  describe('URL-safe base64 encoding', () => {
    it('should produce URL-safe output without + or / characters', () => {
      // Test with data that would normally produce + or / in base64
      const inputs = [
        'test+test',
        'test/test',
        'a'.repeat(100),
        '{"key": "value"}',
        'x'.repeat(50),
      ];

      inputs.forEach((input) => {
        const compressed = compressor.compress(input);
        expect(compressed).not.toMatch(/\+/);
        expect(compressed).not.toMatch(/\//);
        expect(compressed).not.toMatch(/=/);
      });
    });

    it('should handle _0_ and _ encoding correctly', () => {
      const input = 'Test string that will encode with special chars';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should produce output without padding equals signs', () => {
      const inputs = ['a', 'ab', 'abc', 'abcd', 'abcde'];

      inputs.forEach((input) => {
        const compressed = compressor.compress(input);
        expect(compressed).not.toMatch(/=+$/);
      });
    });

    it('should correctly restore padding during decode', () => {
      const inputs = ['Test 1', 'Test 12', 'Test 123', 'Test 1234', 'a', 'ab', 'abc'];

      inputs.forEach((input) => {
        const compressed = compressor.compress(input);
        const decompressed = compressor.decompress(compressed);
        expect(decompressed).toBe(input);
      });
    });
  });

  describe('cross-method compatibility', () => {
    it('should decompress sync what was compressed async', async () => {
      const input = 'Cross compatibility test';
      const asyncCompressed = await compressor.compressAsync(input);
      const syncDecompressed = compressor.decompress(asyncCompressed);

      expect(syncDecompressed).toBe(input);
    });

    it('should decompress async what was compressed sync', async () => {
      const input = 'Cross compatibility test reverse';
      const syncCompressed = compressor.compress(input);
      const asyncDecompressed = await compressor.decompressAsync(syncCompressed);

      expect(asyncDecompressed).toBe(input);
    });
  });

  describe('edge cases', () => {
    it('should handle single character', () => {
      const input = 'a';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should handle very long strings', () => {
      const input = 'Lorem ipsum dolor sit amet. '.repeat(10000);
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(compressed.length).toBeLessThan(input.length / 10);
      expect(decompressed).toBe(input);
    });

    it('should handle binary-like data', () => {
      const input = '\x00\x01\x02\x03\x04\x05';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should handle strings with only spaces', () => {
      const input = '     ';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should handle repeated compression cycles', () => {
      let data = 'Original data';

      for (let i = 0; i < 5; i++) {
        const compressed = compressor.compress(data);
        const decompressed = compressor.decompress(compressed);
        expect(decompressed).toBe(data);
        data = decompressed;
      }

      expect(data).toBe('Original data');
    });
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const newCompressor = new StrCompressor();
      await expect(newCompressor.init()).resolves.toBeUndefined();
    });

    it('should work after initialization', async () => {
      const newCompressor = new StrCompressor();
      await newCompressor.init();

      const input = 'Test after init';
      const compressed = newCompressor.compress(input);
      const decompressed = newCompressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });
  });
});

describe('Compressor singleton', () => {
  it('should be an instance of StrCompressor', () => {
    expect(Compressor).toBeInstanceOf(StrCompressor);
  });

  it('should work without explicit initialization for async methods', async () => {
    const input = 'Test singleton';
    const compressed = await Compressor.compressAsync(input);
    const decompressed = await Compressor.decompressAsync(compressed);

    expect(decompressed).toBe(input);
  });

  it('should maintain state across calls', async () => {
    await Compressor.init();
    const input1 = 'First call';
    const input2 = 'Second call';

    const compressed1 = Compressor.compress(input1);
    const compressed2 = Compressor.compress(input2);

    expect(Compressor.decompress(compressed1)).toBe(input1);
    expect(Compressor.decompress(compressed2)).toBe(input2);
  });
});

describe('round-trip encoding/decoding', () => {
  beforeEach(async () => {
    await Compressor.init();
  });

  it('should preserve data through multiple encode/decode cycles', () => {
    const testStrings = [
      'simple text',
      'test@123:password',
      '中文测试',
      'user:pass',
      'special!@#$%^&*()chars',
      '',
      '{"json": "data"}',
      'a'.repeat(1000),
      'Line 1\nLine 2\tTab',
      '🎉🚀🌍',
    ];

    testStrings.forEach((input) => {
      const compressed = Compressor.compress(input);
      const decompressed = Compressor.decompress(compressed);
      expect(decompressed).toBe(input);
    });
  });
});
