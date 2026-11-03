/**
 * Get client IP address
 * @param headers HTTP request headers
 */
export const getClientIP = (headers: Headers): string => {
  // Check various IP headers in priority order
  const ipHeaders = [
    'cf-connecting-ip', // Cloudflare
    'x-real-ip', // Nginx proxy
    'x-forwarded-for', // Standard proxy header
    'x-client-ip', // Apache
    'true-client-ip', // Akamai and Cloudflare
    'x-cluster-client-ip', // Load balancer
    'forwarded', // RFC 7239
    'fastly-client-ip', // Fastly CDN
    'x-forwarded', // General forward
    'x-original-forwarded-for', // Original forwarded
  ];

  for (const header of ipHeaders) {
    const value = headers.get(header);
    if (!value) continue;

    // Handle cases where multiple IPs may be present (e.g., x-forwarded-for)
    if (header.toLowerCase() === 'x-forwarded-for') {
      const firstIP = value.split(',')[0].trim();
      if (firstIP) return firstIP;
    }

    return value.trim();
  }

  return '';
};
