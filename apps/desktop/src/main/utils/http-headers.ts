/**
 * HTTP headers utilities for Electron webRequest
 *
 * Electron's webRequest responseHeaders is a plain JS object where keys are case-sensitive,
 * but HTTP headers are case-insensitive per spec. These utilities handle this mismatch.
 */

type ElectronResponseHeaders = Record<string, string[]>;

/**
 * Set a header value, replacing any existing header with the same name (case-insensitive)
 */
export function setResponseHeader(
  headers: ElectronResponseHeaders,
  name: string,
  value: string | string[],
): void {
  // Delete any existing header with same name (case-insensitive)
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete headers[key];
    }
  }
  headers[name] = Array.isArray(value) ? value : [value];
}

/**
 * Check if a header exists (case-insensitive)
 */
export function hasResponseHeader(headers: ElectronResponseHeaders, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

/**
 * Get a header value (case-insensitive)
 */
export function getResponseHeader(
  headers: ElectronResponseHeaders,
  name: string,
): string[] | undefined {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return headers[key];
    }
  }
  return undefined;
}

/**
 * Delete a header (case-insensitive)
 */
export function deleteResponseHeader(headers: ElectronResponseHeaders, name: string): boolean {
  let deleted = false;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete headers[key];
      deleted = true;
    }
  }
  return deleted;
}
