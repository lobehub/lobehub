import { describe, expect, it } from 'vitest';

import {
  inferContentTypeFromImageUrl,
  inferFileExtensionFromImageUrl,
  isDesktopLocalStaticServerUrl,
  isLocalOrPrivateUrl,
  pathString,
} from './url';

describe('pathString', () => {
  it('should handle basic path', () => {
    const result = pathString('/home');
    expect(result).toBe('/home');
  });

  it('should handle path with search parameters', () => {
    const result = pathString('/home', { search: 'id=1&name=test' });
    expect(result).toBe('/home?id=1&name=test');
  });

  it('should handle path with hash', () => {
    const result = pathString('/home', { hash: 'top' });
    expect(result).toBe('/home#top');

    const result2 = pathString('/home', { hash: '#hash=abc' });
    expect(result2).toBe('/home#hash=abc');
  });

  it('should handle relative path', () => {
    const result = pathString('./home');
    expect(result).toBe('/home');
  });

  it('should handle path with protocol', () => {
    const result = pathString('https://www.example.com/home');
    expect(result).toBe('https://www.example.com/home');
  });

  it('should handle path with special characters', () => {
    const result = pathString('/home/测试');
    expect(result).toBe('/home/%E6%B5%8B%E8%AF%95');
  });
});

describe('inferContentTypeFromImageUrl', () => {
  it('should handle uppercase extensions', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.JPG');
    expect(result).toBe('image/jpeg');
  });

  it('should handle URLs with query parameters', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.png?v=123&size=large');
    expect(result).toBe('image/png');
  });

  it('should throw error when no extension', () => {
    expect(() => {
      inferContentTypeFromImageUrl('https://example.com/image');
    }).toThrow('Invalid image url: https://example.com/image');
  });

  it('should handle malformed URLs that result in no valid extension', () => {
    // These URLs will be processed by inferFileExtensionFromImageUrl and return empty string
    const invalidUrls = [
      'data:image/jpeg;base64,invalid', // No file extension in path
      'javascript:alert("test")', // No file extension
      'https://example.com/file', // No extension
      'https://example.com/file.', // Dot without extension
      'ftp://example.com/document.pdf', // Valid URL but non-image extension
    ];

    invalidUrls.forEach((url) => {
      expect(() => {
        inferContentTypeFromImageUrl(url);
      }).toThrow(/Invalid image url:/);
    });
  });

  it('should handle all supported image formats consistently', () => {
    const testCases = [
      { extension: 'jpg', expected: 'image/jpeg' },
      { extension: 'jpeg', expected: 'image/jpeg' },
      { extension: 'png', expected: 'image/png' },
      { extension: 'webp', expected: 'image/webp' },
      { extension: 'gif', expected: 'image/gif' },
      { extension: 'bmp', expected: 'image/bmp' },
      { extension: 'svg', expected: 'image/svg+xml' },
      { extension: 'tiff', expected: 'image/tiff' },
      { extension: 'tif', expected: 'image/tiff' },
    ];

    testCases.forEach(({ extension, expected }) => {
      const result = inferContentTypeFromImageUrl(`https://example.com/image.${extension}`);
      expect(result).toBe(expected);
    });
  });

  it('should handle multiple dots in path', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/my.folder/image.test.png');
    expect(result).toBe('image/png');
  });

  it('should handle relative paths', () => {
    const result = inferContentTypeFromImageUrl('generations/images/photo.jpg');
    expect(result).toBe('image/jpeg');
  });
});

describe('inferFileExtensionFromImageUrl', () => {
  it('should handle uppercase extensions and convert to lowercase', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.PNG');
    expect(result).toBe('png');
  });

  it('should handle URLs with query parameters', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.jpg?v=123&size=large');
    expect(result).toBe('jpg');
  });

  it('should handle URLs with hash fragments', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.png#section');
    expect(result).toBe('png');
  });

  it('should return empty string when no extension', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image');
    expect(result).toBe('');
  });

  it('should return empty string for non-image extensions', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/document.txt');
    expect(result).toBe('');
  });

  it('should handle all supported image extensions', () => {
    const supportedExtensions = ['webp', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'tiff', 'tif'];

    supportedExtensions.forEach((ext) => {
      const result = inferFileExtensionFromImageUrl(`https://example.com/image.${ext}`);
      expect(result).toBe(ext);
    });
  });

  it('should handle multiple dots in path', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/my.folder/image.test.webp');
    expect(result).toBe('webp');
  });

  it('should handle relative paths', () => {
    const result = inferFileExtensionFromImageUrl('generations/images/photo.jpg');
    expect(result).toBe('jpg');
  });
});

describe('isDesktopLocalStaticServerUrl', () => {
  it('should return true for 127.0.0.1', () => {
    expect(isDesktopLocalStaticServerUrl('http://127.0.0.1')).toBe(true);
    expect(isDesktopLocalStaticServerUrl('https://127.0.0.1')).toBe(true);
    expect(isDesktopLocalStaticServerUrl('http://127.0.0.1:8080')).toBe(true);
    expect(isDesktopLocalStaticServerUrl('http://127.0.0.1/path/to/resource')).toBe(true);
    expect(isDesktopLocalStaticServerUrl('https://127.0.0.1/path?query=1#hash')).toBe(true);
  });

  it('should return false for other 127.x.x.x addresses', () => {
    expect(isDesktopLocalStaticServerUrl('http://127.0.0.2')).toBe(false);
    expect(isDesktopLocalStaticServerUrl('http://127.1.1.1')).toBe(false);
    expect(isDesktopLocalStaticServerUrl('http://127.255.255.255')).toBe(false);
  });

  it('should return false for localhost', () => {
    expect(isDesktopLocalStaticServerUrl('http://localhost')).toBe(false);
    expect(isDesktopLocalStaticServerUrl('http://localhost:3000')).toBe(false);
    expect(isDesktopLocalStaticServerUrl('https://localhost/api')).toBe(false);
  });

  it('should return false for domain names', () => {
    expect(isDesktopLocalStaticServerUrl('https://example.com')).toBe(false);
    expect(isDesktopLocalStaticServerUrl('http://www.google.com')).toBe(false);
  });

  it('should return false for malformed URLs', () => {
    expect(isDesktopLocalStaticServerUrl('invalid-url')).toBe(false);
    expect(isDesktopLocalStaticServerUrl('http://')).toBe(false);
    expect(isDesktopLocalStaticServerUrl('')).toBe(false);
  });
});

describe('isLocalOrPrivateUrl', () => {
  describe('loopback addresses (127.0.0.0/8)', () => {
    it('should return true for 127.0.0.1', () => {
      expect(isLocalOrPrivateUrl('http://127.0.0.1')).toBe(true);
      expect(isLocalOrPrivateUrl('https://127.0.0.1')).toBe(true);
      expect(isLocalOrPrivateUrl('http://127.0.0.1:8080')).toBe(true);
      expect(isLocalOrPrivateUrl('http://127.0.0.1/path/to/resource')).toBe(true);
      expect(isLocalOrPrivateUrl('https://127.0.0.1/path?query=1#hash')).toBe(true);
    });

    it('should return true for other 127.x.x.x addresses', () => {
      expect(isLocalOrPrivateUrl('http://127.0.0.2')).toBe(true);
      expect(isLocalOrPrivateUrl('http://127.1.1.1')).toBe(true);
      expect(isLocalOrPrivateUrl('http://127.255.255.255')).toBe(true);
    });
  });

  describe('localhost', () => {
    it('should return true for localhost', () => {
      expect(isLocalOrPrivateUrl('http://localhost')).toBe(true);
      expect(isLocalOrPrivateUrl('http://localhost:3000')).toBe(true);
      expect(isLocalOrPrivateUrl('https://localhost/api')).toBe(true);
    });

    it('should return true for localhost subdomains', () => {
      expect(isLocalOrPrivateUrl('http://app.localhost')).toBe(true);
      expect(isLocalOrPrivateUrl('http://test.localhost:8080')).toBe(true);
    });
  });

  describe('IPv6 loopback', () => {
    it('should return true for ::1', () => {
      expect(isLocalOrPrivateUrl('http://[::1]')).toBe(true);
      expect(isLocalOrPrivateUrl('http://[::1]:8080')).toBe(true);
    });
  });

  describe('special addresses', () => {
    it('should return true for 0.0.0.0', () => {
      expect(isLocalOrPrivateUrl('http://0.0.0.0')).toBe(true);
      expect(isLocalOrPrivateUrl('http://0.0.0.0:3000')).toBe(true);
    });
  });

  describe('private network addresses', () => {
    it('should return true for 10.0.0.0/8 (10.x.x.x)', () => {
      expect(isLocalOrPrivateUrl('http://10.0.0.1')).toBe(true);
      expect(isLocalOrPrivateUrl('http://10.1.2.3')).toBe(true);
      expect(isLocalOrPrivateUrl('http://10.255.255.255')).toBe(true);
    });

    it('should return true for 172.16.0.0/12 (172.16-31.x.x)', () => {
      expect(isLocalOrPrivateUrl('http://172.16.0.1')).toBe(true);
      expect(isLocalOrPrivateUrl('http://172.20.10.5')).toBe(true);
      expect(isLocalOrPrivateUrl('http://172.31.255.255')).toBe(true);
    });

    it('should return false for 172.x.x.x outside private range', () => {
      expect(isLocalOrPrivateUrl('http://172.15.0.1')).toBe(false);
      expect(isLocalOrPrivateUrl('http://172.32.0.1')).toBe(false);
    });

    it('should return true for 192.168.0.0/16 (192.168.x.x)', () => {
      expect(isLocalOrPrivateUrl('http://192.168.1.1')).toBe(true);
      expect(isLocalOrPrivateUrl('http://192.168.0.1')).toBe(true);
      expect(isLocalOrPrivateUrl('http://192.168.255.255')).toBe(true);
    });
  });

  describe('public addresses', () => {
    it('should return false for public IP addresses', () => {
      expect(isLocalOrPrivateUrl('http://8.8.8.8')).toBe(false);
      expect(isLocalOrPrivateUrl('http://1.1.1.1')).toBe(false);
      expect(isLocalOrPrivateUrl('http://192.167.1.1')).toBe(false);
      expect(isLocalOrPrivateUrl('http://192.169.1.1')).toBe(false);
    });

    it('should return false for domain names', () => {
      expect(isLocalOrPrivateUrl('https://example.com')).toBe(false);
      expect(isLocalOrPrivateUrl('http://www.google.com')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return false for malformed URLs', () => {
      expect(isLocalOrPrivateUrl('invalid-url')).toBe(false);
      expect(isLocalOrPrivateUrl('http://')).toBe(false);
      expect(isLocalOrPrivateUrl('a string but not a url')).toBe(false);
    });

    it('should return false for empty or nullish strings', () => {
      expect(isLocalOrPrivateUrl('')).toBe(false);
    });

    it('should return false for relative URLs', () => {
      expect(isLocalOrPrivateUrl('/path/to/file')).toBe(false);
      expect(isLocalOrPrivateUrl('./relative/path')).toBe(false);
    });

    it('should return false for invalid IP addresses', () => {
      expect(isLocalOrPrivateUrl('http://256.256.256.256')).toBe(false);
      expect(isLocalOrPrivateUrl('http://192.168.1.256')).toBe(false);
    });
  });
});
