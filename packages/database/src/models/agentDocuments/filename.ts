const SLUG_FALLBACK = 'document';

export const slugifyDocumentTitle = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, '')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');

export const buildDocumentFilename = (title: string, fallbackFilename = 'document.txt'): string => {
  const extensionMatch = fallbackFilename.match(/(\.[^./\\]+)$/);
  const extension = extensionMatch?.[1] || '.txt';
  const slug = slugifyDocumentTitle(title);

  return `${slug || SLUG_FALLBACK}${extension}`;
};
