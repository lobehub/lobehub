import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';

interface UriParserResult {
  base64: string | null;
  mimeType: string | null;
  type: 'url' | 'base64' | null;
}

export const parseDataUri = (dataUri: string): UriParserResult => {
  // Regular expression to match the entire Data URI structure
  const dataUriMatch = dataUri.match(/^data:([^;]+);base64,(.+)$/);

  if (dataUriMatch) {
    // If it's a valid Data URI
    return { base64: dataUriMatch[2], mimeType: dataUriMatch[1], type: 'base64' };
  }

  try {
    new URL(dataUri);
    // If it's a valid URL
    return { base64: null, mimeType: null, type: 'url' };
  } catch {
    // Neither a Data URI nor a valid URL
    return { base64: null, mimeType: null, type: null };
  }
};

/**
 * MIME types supported by Google Gemini External URL feature
 * @see https://ai.google.dev/gemini-api/docs/file-input-methods#supported-content-types
 */
const GOOGLE_EXTERNAL_URL_SUPPORTED_TYPES = new Set([
  // Text file types
  'text/html',
  'text/css',
  'text/plain',
  'text/xml',
  'text/csv',
  'text/rtf',
  'text/javascript',
  // Application file types
  'application/json',
  'application/pdf',
  // Image file types
  'image/bmp',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * Maximum file size limits for Google Gemini file input
 * @see https://ai.google.dev/gemini-api/docs/file-input-methods#method-comparison
 *
 * External URLs: 100MB for all file types
 * Inline data: 100MB general, 50MB for PDFs
 */
const MAX_EXTERNAL_URL_SIZE = 100 * 1024 * 1024; // 100MB for external URLs (all types)
const MAX_INLINE_DATA_SIZE = 100 * 1024 * 1024; // 100MB for inline data (general)
const MAX_INLINE_PDF_SIZE = 50 * 1024 * 1024; // 50MB for inline PDFs only

export { MAX_INLINE_DATA_SIZE, MAX_INLINE_PDF_SIZE };

export interface ExternalUrlValidation {
  /** Content-Length from response headers */
  contentLength: number;
  /** Content-Type from response headers */
  contentType: string;
  /** Whether the URL was rejected due to size limit */
  isTooLarge?: boolean;
  /** Whether the URL is valid for external URL usage */
  isValid: boolean;
  /** Reason for invalid URL */
  reason?: string;
}

/**
 * Check if a URL is an external HTTP(S) URL
 * SSRF protection is enforced by ssrfSafeFetch during validation
 */
export const isPublicExternalUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);

    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

/**
 * Validate an external URL for Google Gemini file input
 * Performs a HEAD request to check Content-Length and Content-Type
 *
 * @param url - The URL to validate
 * @returns Validation result with content info
 */
export const validateExternalUrl = async (url: string): Promise<ExternalUrlValidation> => {
  try {
    // Perform HEAD request to get headers without downloading the file
    const res = await ssrfSafeFetch(
      url,
      {
        headers: {
          'User-Agent': 'LobeChat/1.0 (https://lobehub.com)',
        },
        method: 'HEAD',
      },
      {
        allowIPAddressList: [],
        allowPrivateIPAddress: false,
      },
    );

    if (!res.ok) {
      return {
        contentLength: 0,
        contentType: '',
        isValid: false,
        reason: `HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const contentLength = Number.parseInt(res.headers.get('content-length') || '0', 10);
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

    // Check MIME type support
    if (!GOOGLE_EXTERNAL_URL_SUPPORTED_TYPES.has(contentType)) {
      return {
        contentLength,
        contentType,
        isValid: false,
        reason: `Unsupported content type: ${contentType}`,
      };
    }

    // Check file size - External URLs support 100MB for all file types
    // (Unlike inline data where PDFs are limited to 50MB)
    if (contentLength > MAX_EXTERNAL_URL_SIZE) {
      return {
        contentLength,
        contentType,
        isTooLarge: true,
        isValid: false,
        reason: `File too large: ${contentLength} bytes (max ${MAX_EXTERNAL_URL_SIZE} bytes)`,
      };
    }

    return {
      contentLength,
      contentType,
      isValid: true,
    };
  } catch (error) {
    return {
      contentLength: 0,
      contentType: '',
      isValid: false,
      reason: `Failed to validate URL: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
