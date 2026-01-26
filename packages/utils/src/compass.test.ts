/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Compressor, StrCompressor } from './compass';

// Mock brotli-wasm module
vi.mock('brotli-wasm', () => {
  const mockCompress = (data: Uint8Array) => {
    // Simple mock: just reverse the bytes for testing
    return new Uint8Array([...data].reverse());
  };

  const mockDecompress = (data: Uint8Array) => {
    // Simple mock: reverse back
    return new Uint8Array([...data].reverse());
  };

  return {
    default: Promise.resolve({
      compress: mockCompress,
      decompress: mockDecompress,
    }),
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

  describe('compress and decompress', () => {
    it('should compress and decompress a simple string', () => {
      const original = 'Hello, World!';
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
      expect(compressed).not.toBe(original);
    });

    it('should compress and decompress an empty string', () => {
      const original = '';
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should compress and decompress a string with special characters', () => {
      const original = '!@#$%^&*()_+-={}[]|:;"<>?,./';
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should compress and decompress a string with Unicode characters', () => {
      const original = '你好世界 🌍 مرحبا بالعالم';
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should compress and decompress a string with emojis', () => {
      const original = '😀😃😄😁😆😅🤣😂';
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should compress and decompress a long string', () => {
      const original = 'A'.repeat(1000);
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should compress and decompress JSON data', () => {
      const original = JSON.stringify({ name: 'John', age: 30, hobbies: ['reading', 'gaming'] });
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
      expect(JSON.parse(decompressed)).toEqual(JSON.parse(original));
    });

    it('should compress and decompress multiline text', () => {
      const original = `Line 1
Line 2
Line 3`;
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should compress and decompress text with tabs and newlines', () => {
      const original = 'Tab:\t\tNewline:\n\nCarriage return:\r\n';
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should produce URL-safe base64 output', () => {
      const original = 'Test string for URL safety';
      const compressed = compressor.compress(original);

      // URL-safe base64 should not contain +, /, or =
      expect(compressed).not.toContain('+');
      expect(compressed).not.toContain('/');
      expect(compressed).not.toContain('=');
    });
  });

  describe('compressAsync and decompressAsync', () => {
    it('should compress and decompress a simple string asynchronously', async () => {
      const original = 'Hello, World!';
      const compressed = await compressor.compressAsync(original);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(original);
      expect(compressed).not.toBe(original);
    });

    it('should compress and decompress an empty string asynchronously', async () => {
      const original = '';
      const compressed = await compressor.compressAsync(original);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(original);
    });

    it('should compress and decompress a string with Unicode characters asynchronously', async () => {
      const original = '你好世界 🌍 مرحبا بالعالم';
      const compressed = await compressor.compressAsync(original);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(original);
    });

    it('should compress and decompress a long string asynchronously', async () => {
      const original = 'B'.repeat(1000);
      const compressed = await compressor.compressAsync(original);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(original);
    });

    it('should compress and decompress JSON data asynchronously', async () => {
      const original = JSON.stringify({ name: 'Jane', age: 25, city: 'New York' });
      const compressed = await compressor.compressAsync(original);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(original);
      expect(JSON.parse(decompressed)).toEqual(JSON.parse(original));
    });

    it('should produce URL-safe base64 output asynchronously', async () => {
      const original = 'Test string for URL safety';
      const compressed = await compressor.compressAsync(original);

      // URL-safe base64 should not contain +, /, or =
      expect(compressed).not.toContain('+');
      expect(compressed).not.toContain('/');
      expect(compressed).not.toContain('=');
    });

    it('should work without calling init() first', async () => {
      const newCompressor = new StrCompressor();
      const original = 'Test without init';

      const compressed = await newCompressor.compressAsync(original);
      const decompressed = await newCompressor.decompressAsync(compressed);

      expect(decompressed).toBe(original);
    });
  });

  describe('consistency between sync and async methods', () => {
    it('should produce the same compressed output for sync and async methods', async () => {
      const original = 'Consistency test';
      const syncCompressed = compressor.compress(original);
      const asyncCompressed = await compressor.compressAsync(original);

      expect(syncCompressed).toBe(asyncCompressed);
    });

    it('should decompress output from async compress using sync decompress', async () => {
      const original = 'Cross-method test';
      const compressed = await compressor.compressAsync(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should decompress output from sync compress using async decompress', async () => {
      const original = 'Cross-method test 2';
      const compressed = compressor.compress(original);
      const decompressed = await compressor.decompressAsync(compressed);

      expect(decompressed).toBe(original);
    });
  });

  describe('edge cases', () => {
    it('should handle a string with only spaces', () => {
      const original = '     ';
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should handle a single character', () => {
      const original = 'A';
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should handle repeated characters', () => {
      const original = 'aaaaaaaaaa';
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should handle very long Unicode strings', () => {
      const original = '你'.repeat(500);
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should handle strings with null characters', () => {
      const original = 'before\x00after';
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });

    it('should handle strings with all printable ASCII characters', () => {
      let original = '';
      for (let i = 32; i < 127; i++) {
        original += String.fromCharCode(i);
      }
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      expect(decompressed).toBe(original);
    });
  });

  describe('URL-safe base64 encoding', () => {
    it('should handle strings that produce + in standard base64', () => {
      // Characters that typically produce + in base64
      const original = '\x00\x10\x83';
      const compressed = compressor.compress(original);
      const decompressed = compressor.decompress(compressed);

      // Should not contain + in the compressed output
      expect(compressed).not.toContain('+');
      // Should still decompress correctly
      expect(decompressed).toBe(original);
    });

    it('should handle strings that produce / in standard base64', () => {
      // Characters that typically produce / in base64
      const original = '\x00\x14\xfb';
      const compressed = compressor.compress(original);

      expect(compressed).not.toContain('/');
    });

    it('should handle strings that require padding in standard base64', () => {
      const original = 'A';
      const compressed = compressor.compress(original);

      // Should not end with = padding
      expect(compressed).not.toMatch(/=+$/);
    });

    it('should correctly decode strings with _0_ encoding', async () => {
      const original = 'Test with special encoding';
      const compressed = compressor.compress(original);

      // Even if compressed contains _0_, it should decompress correctly
      const decompressed = compressor.decompress(compressed);
      expect(decompressed).toBe(original);
    });
  });
});

describe('Compressor singleton', () => {
  it('should export a Compressor singleton instance', () => {
    expect(Compressor).toBeInstanceOf(StrCompressor);
  });

  it('should compress and decompress using singleton instance', async () => {
    await Compressor.init();
    const original = 'Singleton test';
    const compressed = Compressor.compress(original);
    const decompressed = Compressor.decompress(compressed);

    expect(decompressed).toBe(original);
  });

  it('should work with async methods on singleton instance', async () => {
    const original = 'Async singleton test';
    const compressed = await Compressor.compressAsync(original);
    const decompressed = await Compressor.decompressAsync(compressed);

    expect(decompressed).toBe(original);
  });
});
