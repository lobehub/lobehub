/**
 * Normalizes package-relative skill paths and rejects unsafe path forms.
 *
 * Before:
 * - "references/../SKILL.md"
 *
 * After:
 * - Throws "path traversal is not allowed"
 */
export const assertPackageRelativePath = (path: string) => {
  if (path.startsWith('/')) throw new Error('absolute paths are not allowed');

  const segments = path.split('/').filter(Boolean);
  if (segments.includes('..')) {
    throw new Error('path traversal is not allowed');
  }

  return segments.join('/');
};
