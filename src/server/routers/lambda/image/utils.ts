/**
 * Recursively validate that no full URLs are present in the config
 * This is a defensive check to ensure only keys are stored in database
 */
export function validateNoUrlsInConfig(obj: any, path: string = ''): void {
  if (typeof obj === 'string') {
    if (obj.startsWith('http://') || obj.startsWith('https://')) {
      throw new Error(
        `Invalid configuration: Found full URL instead of key at ${path || 'root'}. ` +
          `URL: "${obj.slice(0, 100)}${obj.length > 100 ? '...' : ''}". ` +
          `All URLs must be converted to storage keys before database insertion.`,
      );
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      validateNoUrlsInConfig(item, `${path}[${index}]`);
    });
  } else if (obj && typeof obj === 'object') {
    Object.entries(obj).forEach(([key, value]) => {
      const currentPath = path ? `${path}.${key}` : key;
      validateNoUrlsInConfig(value, currentPath);
    });
  }
}
