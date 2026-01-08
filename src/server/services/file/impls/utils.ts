/**
 * Handle legacy bug where full URLs were stored instead of keys
 * Some historical data stored complete URLs in database instead of just keys
 * Related issue: https://github.com/lobehub/lobe-chat/issues/8994
 */
export async function extractKeyFromUrlOrReturnOriginal(
  url: string,
  getKeyFromFullUrl: (url: string) => Promise<string | null>,
): Promise<string> {
  // Only process URLs that start with http:// or https://
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // Extract key from full URL for legacy data compatibility
    const key = await getKeyFromFullUrl(url);
    if (!key) {
      throw new Error('Key not found from url: ' + url);
    }
    return key;
  }
  // Return original input if it's already a key
  return url;
}
