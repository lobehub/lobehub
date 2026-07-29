const PDF_FILE_EXTENSIONS = ['.pdf'];
const PDF_FILE_TYPES = new Set(['pdf', 'application/pdf', 'application/x-pdf']);

const normalizeFileType = (fileType?: string | null) =>
  fileType?.split(';')[0].trim().toLowerCase();

// Signed storage URLs carry `?X-Amz-...` query strings; strip query and fragment
// before extension matching so `.pdf?...` still resolves to `.pdf`.
const stripUrlSuffix = (candidate: string) => candidate.split(/[?#]/)[0];

interface PdfFileFields {
  fileName?: string | null;
  fileType?: string | null;
  path?: string | null;
}

export const isPdfFile = ({ fileName, fileType, path }: PdfFileFields): boolean => {
  const normalizedFileType = normalizeFileType(fileType);

  if (normalizedFileType && PDF_FILE_TYPES.has(normalizedFileType)) return true;

  const candidates = [fileName, path].flatMap((candidate) =>
    candidate ? [stripUrlSuffix(candidate).toLowerCase()] : [],
  );

  if (candidates.length === 0) return false;

  return candidates.some((candidate) =>
    PDF_FILE_EXTENSIONS.some((extension) => candidate.endsWith(extension)),
  );
};
