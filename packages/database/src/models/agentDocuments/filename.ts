const FILENAME_FALLBACK = 'document';

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

export const buildDocumentFilename = (title: string): string => {
  const sanitized = sanitizeDocumentFilename(title);
  return sanitized || FILENAME_FALLBACK;
};

/**
 * Extract the first-level markdown heading (# Title) from content and return
 * the remaining content with that heading stripped.
 *
 * Only matches a `# ` heading that appears at the top of the document
 * (optionally preceded by blank lines), with up to 3 leading spaces per
 * CommonMark. Deeper indentation (a tab or 4 spaces) is an indented code
 * block and is not recognised, so a code line such as `    # install` stays
 * untouched. Setext-style (`===`) headings are not recognised either.
 */
export const extractMarkdownH1Title = (content: string): { content: string; title?: string } => {
  const lines = content.split(/\r?\n/);

  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i >= lines.length) return { content };

  const headingMatch = lines[i].match(/^ {0,3}#[ \t]+(\S.*)$/);
  if (!headingMatch) return { content };

  const title = headingMatch[1].trim();
  if (!title) return { content };

  let j = i + 1;
  while (j < lines.length && lines[j].trim() === '') j += 1;

  return { content: lines.slice(j).join('\n'), title };
};
