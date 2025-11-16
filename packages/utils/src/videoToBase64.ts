/**
 * Convert video URL to base64 data URL with SSRF protection
 * Uses SSRF-safe fetch to prevent SSRF attacks
 */
export const videoUrlToBase64 = async (
  videoUrl: string,
): Promise<{ base64: string; mimeType: string }> => {
  try {
    // Use SSRF-safe fetch to prevent SSRF attacks
    const response = await import('ssrf-safe-fetch').then((m) =>
      m.ssrfSafeFetch(videoUrl, {
        // Add reasonable timeout
        signal: AbortSignal.timeout(30_000), // 30 seconds
      }),
    );

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
