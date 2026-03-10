import { type NextRequest } from 'next/server';

/**
 * Creates a route matcher function that checks if a request path matches any of the given patterns
 * @param patterns Array of route patterns - supports `(.*)` as wildcard
 * @returns Function that returns true if the request matches any pattern
 */
export function createRouteMatcher(patterns: string[]) {
  const regexPatterns = patterns.map((pattern) => {
    // Escape all special regex chars (including parentheses), then restore (.*) to wildcard
    const regexStr = pattern
      .replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&')
      .replaceAll('\\(\\.\\*\\)', '.*');
    return new RegExp(`^${regexStr}$`);
  });

  return (req: NextRequest) => regexPatterns.some((regex) => regex.test(req.nextUrl.pathname));
}
