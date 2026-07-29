const HTML_FILE_EXTENSIONS = ['.html', '.htm'];
const HTML_FILE_TYPES = new Set(['html', 'htm', 'text/html', 'application/xhtml+xml']);

const normalizeFileType = (fileType?: string | null) =>
  fileType?.split(';')[0].trim().toLowerCase();

interface HtmlFileFields {
  fileName?: string | null;
  fileType?: string | null;
  path?: string | null;
}

export const isHtmlFile = ({ fileName, fileType, path }: HtmlFileFields): boolean => {
  const normalizedFileType = normalizeFileType(fileType);

  if (normalizedFileType && HTML_FILE_TYPES.has(normalizedFileType)) return true;

  const candidates = [fileName, path].flatMap((candidate) =>
    candidate ? [candidate.toLowerCase()] : [],
  );

  if (candidates.length === 0) return false;

  return candidates.some((candidate) =>
    HTML_FILE_EXTENSIONS.some((extension) => candidate.endsWith(extension)),
  );
};
