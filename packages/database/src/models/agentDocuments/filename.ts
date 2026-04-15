const SLUG_FALLBACK = 'document';

export const slugifyDocumentTitle = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, '')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');

const sanitizeDocumentFilename = (value: string): string =>
  value
    .trim()
    // Prevent path traversal / nested paths in filenames.
    .replaceAll(/[\\/]/g, '-')
    // Remove null bytes and trim trailing dots/spaces for broad FS compatibility.
    .replaceAll('\0', '')
    .replaceAll(/[.\s]+$/g, '');

export const buildDocumentFilename = (title: string, fallbackFilename = 'document.txt'): string => {
  const extensionMatch = fallbackFilename.match(/(\.[^./\\]+)$/);
  const extension = extensionMatch?.[1] || '.txt';
  const sanitizedTitle = sanitizeDocumentFilename(title);
  if (!sanitizedTitle) return `${SLUG_FALLBACK}${extension}`;

  const typedExtensionMatch = sanitizedTitle.match(/(\.[^./\\]+)$/);
  if (typedExtensionMatch) return sanitizedTitle;

  return `${sanitizedTitle}${extension}`;
};
