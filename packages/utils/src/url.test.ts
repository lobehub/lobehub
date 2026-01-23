import { describe, expect, it } from 'vitest';

import {
  inferContentTypeFromImageUrl,
  inferContentTypeFromUrl,
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

  it('should handle absolute path', () => {
    const result = pathString('/home');
    expect(result).toBe('/home');
  });

  it('should handle path with protocol', () => {
    const result = pathString('https://www.example.com/home');
    expect(result).toBe('https://www.example.com/home');
  });

  it('should handle path with hostname', () => {
    const result = pathString('//www.example.com/home');
    expect(result).toBe('https://www.example.com/home');
  });

  it('should handle path with port number', () => {
    const result = pathString('//www.example.com:8080/home');
    expect(result).toBe('https://www.example.com:8080/home');
  });

  it('should handle path with special characters', () => {
    const result = pathString('/home/测试');
    expect(result).toBe('/home/%E6%B5%8B%E8%AF%95');
  });
});

describe('inferContentTypeFromImageUrl', () => {
  it('should return correct MIME type for jpg images', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.jpg');
    expect(result).toBe('image/jpeg');
  });

  it('should return correct MIME type for png images', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.png');
    expect(result).toBe('image/png');
  });

  it('should return correct MIME type for webp images', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.webp');
    expect(result).toBe('image/webp');
  });

  it('should return correct MIME type for gif images', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.gif');
    expect(result).toBe('image/gif');
  });

  it('should handle uppercase extensions', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.JPG');
    expect(result).toBe('image/jpeg');
  });

  it('should handle URLs with query parameters', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.png?v=123&size=large');
    expect(result).toBe('image/png');
  });

  it('should handle URLs with hash fragments', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.jpg#section');
    expect(result).toBe('image/jpeg');
  });

  it('should throw error when no extension', () => {
    expect(() => {
      inferContentTypeFromImageUrl('https://example.com/image');
    }).toThrow('Invalid image url: https://example.com/image');
  });

  it('should throw error when only dot without extension', () => {
    expect(() => {
      inferContentTypeFromImageUrl('https://example.com/image.');
    }).toThrow('Invalid image url: https://example.com/image.');
  });

  it('should handle multiple dots in path', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/my.folder/image.test.png');
    expect(result).toBe('image/png');
  });

  it('should handle complex query parameters and hash combination', () => {
    const result = inferContentTypeFromImageUrl(
      'https://example.com/image.jpeg?width=800&height=600&format=jpeg#preview',
    );
    expect(result).toBe('image/jpeg');
  });

  it('should handle mixed case extensions', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.JpEg');
    expect(result).toBe('image/jpeg');
  });

  it('should handle BMP format', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.bmp');
    expect(result).toBe('image/bmp');
  });

  it('should handle TIFF format', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.tiff');
    expect(result).toBe('image/tiff');
  });

  it('should handle TIF format', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.tif');
    expect(result).toBe('image/tiff');
  });

  it('should handle SVG format', () => {
    const result = inferContentTypeFromImageUrl('https://example.com/image.svg');
    expect(result).toBe('image/svg+xml');
  });

  it('should throw error for invalid URLs', () => {
    expect(() => {
      inferContentTypeFromImageUrl('invalid-url');
    }).toThrow('Invalid image url: invalid-url');
  });

  it('should throw error for empty string', () => {
    expect(() => {
      inferContentTypeFromImageUrl('');
    }).toThrow('Invalid image url: ');
  });

  it('should throw error for non-image extensions', () => {
    expect(() => {
      inferContentTypeFromImageUrl('https://example.com/document.txt');
    }).toThrow('Invalid image url: https://example.com/document.txt');
  });

  it('should throw error for unknown extensions', () => {
    expect(() => {
      inferContentTypeFromImageUrl('https://example.com/file.unknownext');
    }).toThrow('Invalid image url: https://example.com/file.unknownext');
  });

  it('should handle URLs with port numbers', () => {
    const result = inferContentTypeFromImageUrl('https://example.com:8080/image.png');
    expect(result).toBe('image/png');
  });

  it('should handle deeply nested paths', () => {
    const result = inferContentTypeFromImageUrl(
      'https://cdn.example.com/assets/images/gallery/2024/photo.jpg',
    );
    expect(result).toBe('image/jpeg');
  });

  it('should handle encoded filenames', () => {
    const result = inferContentTypeFromImageUrl(
      'https://example.com/images/%E5%9B%BE%E7%89%87.png',
    );
    expect(result).toBe('image/png');
  });

  it('should handle protocol-relative URLs', () => {
    const result = inferContentTypeFromImageUrl('//example.com/image.webp');
    expect(result).toBe('image/webp');
  });

  it('should handle relative paths', () => {
    const result = inferContentTypeFromImageUrl('generations/images/photo.jpg');
    expect(result).toBe('image/jpeg');
  });

  it('should handle relative paths with complex filenames', () => {
    const result = inferContentTypeFromImageUrl(
      'generations/images/2NPfAQAMNxXPi82mzOHog_1056x1136_20250702_110911_raw.png',
    );
    expect(result).toBe('image/png');
  });

  it('should handle relative paths with query parameters', () => {
    const result = inferContentTypeFromImageUrl('images/photo.webp?v=123');
    expect(result).toBe('image/webp');
  });

  it('should handle relative paths with hash fragments', () => {
    const result = inferContentTypeFromImageUrl('assets/images/banner.gif#preview');
    expect(result).toBe('image/gif');
  });

  it('should throw error for single character extensions (if no valid MIME type)', () => {
    expect(() => {
      inferContentTypeFromImageUrl('https://example.com/file.x');
    }).toThrow('Invalid image url: https://example.com/file.x');
  });

  it('should throw error for dot at end of path', () => {
    expect(() => {
      inferContentTypeFromImageUrl('https://example.com/path/.');
    }).toThrow('Invalid image url: https://example.com/path/.');
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
});

describe('inferFileExtensionFromImageUrl', () => {
  it('should return jpg extension', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.jpg');
    expect(result).toBe('jpg');
  });

  it('should return png extension', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.png');
    expect(result).toBe('png');
  });

  it('should return webp extension', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.webp');
    expect(result).toBe('webp');
  });

  it('should handle jpeg extension', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.jpeg');
    expect(result).toBe('jpeg');
  });

  it('should handle gif extension', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.gif');
    expect(result).toBe('gif');
  });

  it('should handle svg extension', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.svg');
    expect(result).toBe('svg');
  });

  it('should handle uppercase extensions and convert to lowercase', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.PNG');
    expect(result).toBe('png');
  });

  it('should handle mixed case extensions', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.JpEg');
    expect(result).toBe('jpeg');
  });

  it('should handle URLs with query parameters', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.jpg?v=123&size=large');
    expect(result).toBe('jpg');
  });

  it('should handle URLs with hash fragments', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.png#section');
    expect(result).toBe('png');
  });

  it('should handle multiple dots in path', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/my.folder/image.test.webp');
    expect(result).toBe('webp');
  });

  it('should return empty string when no extension', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image');
    expect(result).toBe('');
  });

  it('should return empty string when only dot without extension', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/image.');
    expect(result).toBe('');
  });

  it('should return empty string for non-image extensions', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/document.txt');
    expect(result).toBe('');
  });

  it('should return empty string for other format extensions', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com/video.mp4');
    expect(result).toBe('');
  });

  it('should handle invalid URLs and return empty string', () => {
    const result = inferFileExtensionFromImageUrl('invalid-url');
    expect(result).toBe('');
  });

  it('should handle empty string URLs and return empty string', () => {
    const result = inferFileExtensionFromImageUrl('');
    expect(result).toBe('');
  });

  it('should handle all supported image extensions', () => {
    const supportedExtensions = ['webp', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'tiff', 'tif'];

    supportedExtensions.forEach((ext) => {
      const result = inferFileExtensionFromImageUrl(`https://example.com/image.${ext}`);
      expect(result).toBe(ext);
    });
  });

  it('should handle URLs with port numbers', () => {
    const result = inferFileExtensionFromImageUrl('https://example.com:8080/image.jpg');
    expect(result).toBe('jpg');
  });

  it('should handle subdomain URLs', () => {
    const result = inferFileExtensionFromImageUrl('https://cdn.example.com/images/photo.webp');
    expect(result).toBe('webp');
  });

  it('should handle deep path URLs', () => {
    const result = inferFileExtensionFromImageUrl(
      'https://example.com/assets/images/gallery/photo.png',
    );
    expect(result).toBe('png');
  });

  it('should handle encoded URLs', () => {
    const result = inferFileExtensionFromImageUrl(
      'https://example.com/images/%E5%9B%BE%E7%89%87.jpg',
    );
    expect(result).toBe('jpg');
  });

  it('should handle relative paths', () => {
    const result = inferFileExtensionFromImageUrl('generations/images/photo.jpg');
    expect(result).toBe('jpg');
  });

  it('should handle relative paths with complex filenames', () => {
    const result = inferFileExtensionFromImageUrl(
      'generations/images/2NPfAQAMNxXPi82mzOHog_1056x1136_20250702_110911_raw.png',
    );
    expect(result).toBe('png');
  });

  it('should handle relative paths with query parameters', () => {
    const result = inferFileExtensionFromImageUrl('images/photo.webp?v=123');
    expect(result).toBe('webp');
  });

  it('should handle relative paths with hash fragments', () => {
    const result = inferFileExtensionFromImageUrl('assets/images/banner.gif#preview');
    expect(result).toBe('gif');
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

describe('inferContentTypeFromUrl', () => {
  describe('image files', () => {
    it('should return correct MIME types for common image formats', () => {
      expect(inferContentTypeFromUrl('https://example.com/image.jpg')).toBe('image/jpeg');
      expect(inferContentTypeFromUrl('https://example.com/image.png')).toBe('image/png');
      expect(inferContentTypeFromUrl('https://example.com/image.webp')).toBe('image/webp');
      expect(inferContentTypeFromUrl('https://example.com/image.gif')).toBe('image/gif');
    });
  });

  describe('audio files', () => {
    it('should return correct MIME types for common audio formats', () => {
      expect(inferContentTypeFromUrl('https://example.com/audio.mp3')).toBe('audio/mp3');
      expect(inferContentTypeFromUrl('files/mcp/audio/2025-12-14/YdRVoA3B.mp3')).toBe('audio/mp3');
      expect(inferContentTypeFromUrl('https://example.com/sound.wav')).toBe('audio/wav');
      expect(inferContentTypeFromUrl('https://example.com/music.ogg')).toBe('audio/ogg');
    });
  });

  describe('case insensitive', () => {
    it('should handle mixed case extensions', () => {
      expect(inferContentTypeFromUrl('https://example.com/audio.MP3')).toBe('audio/mp3');
      expect(inferContentTypeFromUrl('https://example.com/image.JPG')).toBe('image/jpeg');
    });
  });

  describe('URLs with query parameters and fragments', () => {
    it('should extract content type ignoring query parameters and hash fragments', () => {
      expect(inferContentTypeFromUrl('https://example.com/audio.mp3?v=123&size=large')).toBe('audio/mp3');
      expect(inferContentTypeFromUrl('https://example.com/audio.mp3#section')).toBe('audio/mp3');
    });
  });

  describe('fallback behavior', () => {
    it('should return fallback for unknown extensions', () => {
      expect(inferContentTypeFromUrl('https://example.com/file.xyz')).toBe('application/octet-stream');
      expect(inferContentTypeFromUrl('https://example.com/file')).toBe('application/octet-stream');
      expect(inferContentTypeFromUrl('https://example.com/file.')).toBe('application/octet-stream');
    });
  });

  describe('relative paths', () => {
    it('should handle relative paths', () => {
      expect(inferContentTypeFromUrl('files/mcp/audio/2025-12-14/test.mp3')).toBe('audio/mp3');
      expect(inferContentTypeFromUrl('./images/photo.jpg')).toBe('image/jpeg');
      expect(inferContentTypeFromUrl('../sounds/beep.wav')).toBe('audio/wav');
    });
  });
});
