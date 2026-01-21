import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Compressor, StrCompressor } from './compass';

// Mock brotli-wasm since it requires WASM loading which doesn't work in test environment
vi.mock('brotli-wasm', () => {
  // Simple mock implementation that simulates compression/decompression
  const mockCompress = (input: Uint8Array): Uint8Array => {
    // Simple mock: just return a modified version of input
    // In real brotli, this would be compressed data
    // Add a simple header and store length as 4 bytes (32-bit int)
    const compressed = new Uint8Array(input.length + 5);
    compressed[0] = 0xff; // Mock header magic byte
    // Store length as 4 bytes (big-endian)
    compressed[1] = (input.length >> 24) & 0xff;
    compressed[2] = (input.length >> 16) & 0xff;
    compressed[3] = (input.length >> 8) & 0xff;
    compressed[4] = input.length & 0xff;
    compressed.set(input, 5);
    return compressed;
  };

  const mockDecompress = (input: Uint8Array): Uint8Array => {
    // Simple mock: extract the original data
    if (input[0] !== 0xff) {
      throw new Error('Invalid compressed data');
    }
    // Read length from 4 bytes (big-endian)
    const length = (input[1] << 24) | (input[2] << 16) | (input[3] << 8) | input[4];
    return input.slice(5, 5 + length);
  };

  const mockInstance = {
    compress: mockCompress,
    decompress: mockDecompress,
  };

  return {
    default: Promise.resolve(mockInstance),
  };
});

describe('StrCompressor', () => {
  let compressor: StrCompressor;

  beforeEach(async () => {
    compressor = new StrCompressor();
    await compressor.init();
  });

  describe('initialization', () => {
    it('should initialize the instance correctly', async () => {
      const newCompressor = new StrCompressor();
      await newCompressor.init();

      // Instance should be initialized and ready to use
      expect(() => newCompressor.compress('test')).not.toThrow();
    });
  });

  describe('compress', () => {
    it('should compress a simple string', () => {
      const input = 'Hello, World!';
      const result = compressor.compress(input);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result).not.toBe(input);
    });

    it('should compress an empty string', () => {
      const input = '';
      const result = compressor.compress(input);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should compress a long string', () => {
      const input = 'Lorem ipsum '.repeat(100);
      const result = compressor.compress(input);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should compress Unicode characters', () => {
      const input = '你好世界 🌍 مرحبا بالعالم';
      const result = compressor.compress(input);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should compress special characters', () => {
      const input = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\~`';
      const result = compressor.compress(input);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should produce URL-safe output (no +, /, or = characters)', () => {
      // Test with various inputs to ensure URL safety
      const inputs = [
        'test',
        'Hello, World!',
        'a'.repeat(100),
        '你好世界',
        'special!@#$%^&*()chars',
      ];

      inputs.forEach((input) => {
        const result = compressor.compress(input);
        // URL-unsafe characters should be replaced
        expect(result).not.toContain('=');
        expect(result).not.toContain('/');
        // '+' is replaced with '_0_'
        expect(result).not.toContain('+');
      });
    });
  });

  describe('decompress', () => {
    it('should decompress a compressed string', () => {
      const input = 'Hello, World!';
      const compressed = compressor.compress(input);
      const result = compressor.decompress(compressed);

      expect(result).toBe(input);
    });

    it('should decompress an empty string', () => {
      const input = '';
      const compressed = compressor.compress(input);
      const result = compressor.decompress(compressed);

      expect(result).toBe(input);
    });

    it('should decompress a long string', () => {
      const input = 'Lorem ipsum '.repeat(100);
      const compressed = compressor.compress(input);
      const result = compressor.decompress(compressed);

      expect(result).toBe(input);
    });

    it('should decompress Unicode characters', () => {
      const input = '你好世界 🌍 مرحبا بالعالم';
      const compressed = compressor.compress(input);
      const result = compressor.decompress(compressed);

      expect(result).toBe(input);
    });

    it('should decompress special characters', () => {
      const input = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\~`';
      const compressed = compressor.compress(input);
      const result = compressor.decompress(compressed);

      expect(result).toBe(input);
    });
  });

  describe('compressAsync', () => {
    it('should compress a simple string asynchronously', async () => {
      const input = 'Hello, World!';
      const result = await compressor.compressAsync(input);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result).not.toBe(input);
    });

    it('should compress an empty string asynchronously', async () => {
      const input = '';
      const result = await compressor.compressAsync(input);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should compress a long string asynchronously', async () => {
      const input = 'Lorem ipsum '.repeat(100);
      const result = await compressor.compressAsync(input);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should compress Unicode characters asynchronously', async () => {
      const input = '你好世界 🌍 مرحبا بالعالم';
      const result = await compressor.compressAsync(input);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should produce URL-safe output asynchronously', async () => {
      const input = 'test@123:password';
      const result = await compressor.compressAsync(input);

      expect(result).not.toContain('=');
      expect(result).not.toContain('/');
      expect(result).not.toContain('+');
    });
  });

  describe('decompressAsync', () => {
    it('should decompress a compressed string asynchronously', async () => {
      const input = 'Hello, World!';
      const compressed = await compressor.compressAsync(input);
      const result = await compressor.decompressAsync(compressed);

      expect(result).toBe(input);
    });

    it('should decompress an empty string asynchronously', async () => {
      const input = '';
      const compressed = await compressor.compressAsync(input);
      const result = await compressor.decompressAsync(compressed);

      expect(result).toBe(input);
    });

    it('should decompress a long string asynchronously', async () => {
      const input = 'Lorem ipsum '.repeat(100);
      const compressed = await compressor.compressAsync(input);
      const result = await compressor.decompressAsync(compressed);

      expect(result).toBe(input);
    });

    it('should decompress Unicode characters asynchronously', async () => {
      const input = '你好世界 🌍 مرحبا بالعالم';
      const compressed = await compressor.compressAsync(input);
      const result = await compressor.decompressAsync(compressed);

      expect(result).toBe(input);
    });
  });

  describe('round-trip compression/decompression', () => {
    it('should preserve data through sync compress/decompress cycle', () => {
      const testStrings = [
        'simple text',
        'test@123:password',
        '中文测试',
        'user:pass',
        'special!@#$%^&*()chars',
        '',
        'a',
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        '{"key": "value", "nested": {"array": [1, 2, 3]}}',
        'line1\nline2\nline3',
        '\t\r\n',
        '🚀 🌟 💻 🎉',
      ];

      testStrings.forEach((input) => {
        const compressed = compressor.compress(input);
        const decompressed = compressor.decompress(compressed);
        expect(decompressed).toBe(input);
      });
    });

    it('should preserve data through async compress/decompress cycle', async () => {
      const testStrings = [
        'simple text',
        'test@123:password',
        '中文测试',
        'user:pass',
        'special!@#$%^&*()chars',
        '',
        'a',
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        '{"key": "value", "nested": {"array": [1, 2, 3]}}',
        'line1\nline2\nline3',
        '\t\r\n',
        '🚀 🌟 💻 🎉',
      ];

      for (const input of testStrings) {
        const compressed = await compressor.compressAsync(input);
        const decompressed = await compressor.decompressAsync(compressed);
        expect(decompressed).toBe(input);
      }
    });

    it('should produce same result for sync and async compression', async () => {
      const input = 'test string for comparison';

      const syncCompressed = compressor.compress(input);
      const asyncCompressed = await compressor.compressAsync(input);

      // Both should produce the same compressed output
      expect(syncCompressed).toBe(asyncCompressed);
    });

    it('should be able to decompress sync-compressed data with async method', async () => {
      const input = 'cross-method test';
      const syncCompressed = compressor.compress(input);
      const asyncDecompressed = await compressor.decompressAsync(syncCompressed);

      expect(asyncDecompressed).toBe(input);
    });

    it('should be able to decompress async-compressed data with sync method', async () => {
      const input = 'cross-method test reverse';
      const asyncCompressed = await compressor.compressAsync(input);
      const syncDecompressed = compressor.decompress(asyncCompressed);

      expect(syncDecompressed).toBe(input);
    });
  });

  describe('compression effectiveness', () => {
    it('should compress repetitive content', () => {
      const input = 'repeat '.repeat(1000);
      const compressed = compressor.compress(input);

      // With the mock, we're just testing that compression works
      // Real brotli would compress repetitive content very well
      expect(compressed).toBeTruthy();
      expect(typeof compressed).toBe('string');
    });

    it('should handle non-compressible random data', () => {
      // Random data doesn't compress well, but should still work
      const input = Array.from({ length: 100 }, () =>
        String.fromCharCode(Math.floor(Math.random() * 94) + 33),
      ).join('');

      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });
  });

  describe('edge cases', () => {
    it('should handle very long strings', () => {
      const input = 'a'.repeat(10000);
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should handle strings with only whitespace', () => {
      const input = '   \t\n\r   ';
      const compressed = compressor.compress(input);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(input);
    });

    it('should handle single character strings', () => {
      const chars = ['a', '1', '!', '中', '🎉'];

      chars.forEach((char) => {
        const compressed = compressor.compress(char);
        const decompressed = compressor.decompress(compressed);
        expect(decompressed).toBe(char);
      });
    });

    it('should handle JSON strings', () => {
      const jsonInput = JSON.stringify({
        name: 'Test',
        value: 123,
        nested: {
          array: [1, 2, 3],
          boolean: true,
        },
      });

      const compressed = compressor.compress(jsonInput);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(jsonInput);
      expect(JSON.parse(decompressed)).toEqual(JSON.parse(jsonInput));
    });
  });
});

describe('Compressor singleton', () => {
  it('should be an instance of StrCompressor', () => {
    expect(Compressor).toBeInstanceOf(StrCompressor);
  });

  it('should be ready to use after initialization', async () => {
    await Compressor.init();

    const input = 'test singleton';
    const compressed = Compressor.compress(input);
    const decompressed = Compressor.decompress(compressed);

    expect(decompressed).toBe(input);
  });

  it('should maintain state across multiple operations', async () => {
    await Compressor.init();

    const inputs = ['test1', 'test2', 'test3'];

    inputs.forEach((input) => {
      const compressed = Compressor.compress(input);
      const decompressed = Compressor.decompress(compressed);
      expect(decompressed).toBe(input);
    });
  });
});
