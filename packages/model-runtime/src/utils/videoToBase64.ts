/**
 * URL validation for SSRF protection
 */
const isValidVideoUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url);

    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return false;
    }

    // Block localhost and private IP ranges
    const hostname = urlObj.hostname.toLowerCase();
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];

    if (blockedHosts.includes(hostname)) {
      return false;
    }

    // Block private IP ranges
    const isPrivateIP = (ip: string): boolean => {
      // IPv4 private ranges
      const ipv4PrivateRanges = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

      // IPv6 private ranges
      const ipv6PrivateRanges = [/^fc00:/, /^fd00:/, /^fe80:/];

      return (
        ipv4PrivateRanges.some((range) => range.test(ip)) ||
        ipv6PrivateRanges.some((range) => range.test(ip))
      );
    };

    if (isPrivateIP(hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

/**
 * Convert video URL to base64 data URL with SSRF protection
 */
export const videoUrlToBase64 = async (
  videoUrl: string,
): Promise<{ base64: string; mimeType: string }> => {
  if (!isValidVideoUrl(videoUrl)) {
    throw new Error('Invalid or unsafe video URL');
  }

  try {
    const response = await fetch(videoUrl, {
      // Add reasonable timeout
      signal: AbortSignal.timeout(30_000), // 30 seconds
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('video/')) {
      throw new Error('URL does not point to a valid video file');
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      base64,
      mimeType: contentType,
    };
  } catch (error) {
    console.error('Error converting video to base64:', error);
    throw error;
  }
};
