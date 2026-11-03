import mime from 'mime';

/**
 * Build a path string from a path and a hash/search object
 *
 * This function constructs a properly formatted URL path by combining a base path
 * with optional hash and search parameters. It uses URL constructor for proper
 * encoding and formatting while removing the temporary base domain.
 *
 * @param path - The base path (can be relative, absolute, or include protocol)
 * @param options - Optional configuration object
 * @param options.hash - Hash fragment to append (with or without leading #)
 * @param options.search - Search/query parameters to append (with or without leading ?)
 * @returns Formatted path string with hash and search parameters
 *
 * @example
 * ```typescript
 * pathString('/home') // '/home'
 * pathString('/home', { search: 'id=1&name=test' }) // '/home?id=1&name=test'
 * pathString('/home', { hash: 'top' }) // '/home#top'
 * pathString('./home') // '/home'
 * pathString('https://example.com/path') // 'https://example.com/path'
 * ```
 */
export const pathString = (
  path: string,
  {
    hash = '',
    search = '',
  }: {
    hash?: string;
    search?: string;
  } = {},
) => {
  // Use a temporary base URL for proper URL parsing and formatting
  const tempBase = 'https://a.com';
  const url = new URL(path, tempBase);

  // Add hash fragment if provided
  if (hash) url.hash = hash;
  // Add search parameters if provided
  if (search) url.search = search;

  // Return the formatted URL without the temporary base
  return url.toString().replace(tempBase, '');
};

/**
 * Get file extension from URL
 *
 * This function extracts the file extension from a URL's pathname and validates it against
 * common image formats. It properly handles URLs with query parameters, hash fragments,
 * relative paths, and various edge cases. Returns empty string for invalid cases.
 *
 * @param url - The URL to extract extension from (can be relative, absolute, or include query parameters and hash fragments)
 * @returns file extension without dot (e.g., 'jpg', 'png', 'webp'), or empty string for invalid cases
 *
 * @example
 * ```typescript
 * inferFileExtensionFromImageUrl('https://example.com/image.jpg') // 'jpg'
 * inferFileExtensionFromImageUrl('https://example.com/image.png?v=123') // 'png'
 * inferFileExtensionFromImageUrl('https://example.com/image.webp#section') // 'webp'
 * inferFileExtensionFromImageUrl('generations/images/photo.png') // 'png'
 * inferFileExtensionFromImageUrl('https://example.com/document.txt') // '' (empty string)
 * inferFileExtensionFromImageUrl('invalid-url') // '' (empty string)
 * ```
 */
export const inferFileExtensionFromImageUrl = (url: string): string => {
  // Use a temporary base URL for proper URL parsing and formatting (handles relative paths)
  const tempBase = 'https://a.com';
  const urlObj = new URL(url, tempBase);
  const pathname = urlObj.pathname;

  // Find the last dot in the pathname to get the file extension
  const lastDotIndex = pathname.lastIndexOf('.');
  if (lastDotIndex === -1) return ''; // No extension found, return empty string

  // Extract extension after the last dot and convert to lowercase
  const extension = pathname.slice(Math.max(0, lastDotIndex + 1)).toLowerCase();

  // Validate against common image extensions
  const validImageExtensions = ['webp', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'tiff', 'tif'];
  if (validImageExtensions.includes(extension)) {
    return extension;
  }

  // Default fallback for non-image extensions
  return '';
};

/**
 * Infer content type (MIME type) from an image URL
 *
 * This function extracts the file extension from a URL and returns the corresponding MIME type.
 * It properly handles URLs with query parameters, hash fragments, relative paths, and various edge cases.
 *
 * @param url - The image URL to analyze (can be relative, absolute, or include query parameters and hash fragments)
 * @returns MIME type string (e.g., 'image/jpeg', 'image/png')
 * @throws {Error} When the URL doesn't contain a valid file extension
 *
 * @example
 * ```typescript
 * inferContentTypeFromImageUrl('https://example.com/image.jpg') // 'image/jpeg'
 * inferContentTypeFromImageUrl('https://example.com/image.png?v=123') // 'image/png'
 * inferContentTypeFromImageUrl('https://example.com/image.webp#section') // 'image/webp'
 * inferContentTypeFromImageUrl('generations/images/photo.png') // 'image/png'
 * ```
 */
export function inferContentTypeFromImageUrl(url: string) {
  // Get the file extension using the dedicated function
  // inferFileExtensionFromImageUrl only returns valid image extensions or empty string
  const extension = inferFileExtensionFromImageUrl(url);

  // If no valid extension found, throw error
  if (!extension) {
    throw new Error(`Invalid image url: ${url}`);
  }

  // Get MIME type using the mime library
  // Since extension is guaranteed to be a valid image extension from the whitelist,
  // mime.getType() will always return a valid image MIME type
  const mimeType = mime.getType(extension);

  return mimeType!; // Non-null assertion is safe due to whitelist validation
}

/**
 *
 * Check if a URL points to desktop local static server
 *
 * @example
 * ```typescript
 * isDesktopLocalStaticServerUrl('http://127.0.0.1:8080/path') // true
 * isDesktopLocalStaticServerUrl('http://localhost:8080/path') // false
 * isDesktopLocalStaticServerUrl('https://example.com') // false
 * isDesktopLocalStaticServerUrl('invalid-url') // false (instead of throwing)
 * isDesktopLocalStaticServerUrl('') // false (instead of throwing)
 * ```
 *
 * check: apps/desktop/src/main/core/StaticFileServerManager.ts
 */
export function isDesktopLocalStaticServerUrl(url: string) {
  try {
    return new URL(url).hostname === '127.0.0.1';
  } catch {
    // Return false for malformed URLs instead of throwing
    return false;
  }
}

/**
 * Check if a URL points to localhost or private network address
 *
 * This function determines if the provided URL's hostname is a local or private network address.
 * It checks for:
 * - localhost (with or without domain suffix)
 * - 127.0.0.0/8 (loopback addresses)
 * - ::1 (IPv6 loopback)
 * - 0.0.0.0
 * - 10.0.0.0/8 (private network)
 * - 172.16.0.0/12 (private network)
 * - 192.168.0.0/16 (private network)
 *
 * It handles malformed URLs gracefully by returning false instead of throwing errors.
 *
 * @param url - The URL string to check
 * @returns true if the URL points to a local or private network address, false otherwise
 *
 * @example
 * ```typescript
 * isLocalOrPrivateUrl('http://127.0.0.1:8080/path') // true
 * isLocalOrPrivateUrl('http://localhost:3000') // true
 * isLocalOrPrivateUrl('http://192.168.1.1') // true
 * isLocalOrPrivateUrl('http://10.0.0.1') // true
 * isLocalOrPrivateUrl('https://example.com') // false
 * isLocalOrPrivateUrl('invalid-url') // false (instead of throwing)
 * isLocalOrPrivateUrl('') // false (instead of throwing)
 * ```
 */
export function isLocalOrPrivateUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Check for localhost variants
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      return true;
    }

    // Check for IPv6 loopback
    if (hostname === '::1' || hostname === '[::1]') {
      return true;
    }

    // Check for 0.0.0.0
    if (hostname === '0.0.0.0') {
      return true;
    }

    // Check for IPv4 loopback and private networks
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);

      // Validate that all octets are in valid range (0-255)
      if (a > 255 || b > 255 || c > 255 || d > 255) {
        return false;
      }

      // 127.0.0.0/8 - Loopback
      if (a === 127) {
        return true;
      }

      // 10.0.0.0/8 - Private network
      if (a === 10) {
        return true;
      }

      // 172.16.0.0/12 - Private network
      if (a === 172 && b >= 16 && b <= 31) {
        return true;
      }

      // 192.168.0.0/16 - Private network
      if (a === 192 && b === 168) {
        return true;
      }
    }

    return false;
  } catch {
    // Return false for malformed URLs instead of throwing
    return false;
  }
}
