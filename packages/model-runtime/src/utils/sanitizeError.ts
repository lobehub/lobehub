/**
 * Sanitizes error objects by removing sensitive information that could expose API keys or other credentials.
 * This is particularly important for errors from Azure/OpenAI SDKs that may include request headers.
 */
export function sanitizeError(error: any): any {
  if (!error || typeof error !== 'object') {
    return error;
  }

  // Handle array of errors
  if (Array.isArray(error)) {
    return error.map(sanitizeError);
  }

  // Create a sanitized copy
  const sanitized: any = {};

  // List of sensitive fields that should be removed or masked
  const sensitiveFields = [
    'request',
    'headers',
    'authorization',
    'apikey',
    'api-key',
    'ocp-apim-subscription-key',
    'x-api-key',
    'bearer',
    'token',
    'auth',
    'credential',
    'key',
    'secret',
    'password',
    'config',
    'options',
  ];

  // Copy safe fields and recursively sanitize nested objects
  for (const key in error) {
    if (error.hasOwnProperty(key)) {
      const value = error[key];
      const lowerKey = key.toLowerCase();

      // Skip sensitive fields entirely
      if (sensitiveFields.includes(lowerKey)) {
        continue;
      }

      // Recursively sanitize nested objects
      if (value && typeof value === 'object') {
        sanitized[key] = sanitizeError(value);
      } else {
        sanitized[key] = value;
      }
    }
  }

  return sanitized;
}
