const PDF_FILE_EXTENSIONS = ['.pdf'];
const PDF_FILE_TYPES = new Set(['pdf', 'application/pdf', 'application/x-pdf']);
const DOCX_FILE_EXTENSIONS = ['.docx'];
const DOCX_FILE_TYPES = new Set([
  'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const PPTX_FILE_EXTENSIONS = ['.pptx'];
const PPTX_FILE_TYPES = new Set([
  'pptx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const XLSX_FILE_EXTENSIONS = ['.xlsx'];
const XLSX_FILE_TYPES = new Set([
  'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const normalizeFileType = (fileType?: string | null) =>
  fileType?.split(';')[0].trim().toLowerCase();

// Signed storage URLs carry `?X-Amz-...` query strings; strip query and fragment
// before extension matching so `.pdf?...` still resolves to `.pdf`.
const stripUrlSuffix = (candidate: string) => candidate.split(/[?#]/)[0];

interface FileTypeFields {
  fileName?: string | null;
  fileType?: string | null;
  path?: string | null;
}

const matchesFileType = (
  { fileName, fileType, path }: FileTypeFields,
  fileTypes: Set<string>,
  fileExtensions: string[],
): boolean => {
  const normalizedFileType = normalizeFileType(fileType);

  if (normalizedFileType && fileTypes.has(normalizedFileType)) return true;

  const candidates = [fileName, path].flatMap((candidate) =>
    candidate ? [stripUrlSuffix(candidate).toLowerCase()] : [],
  );

  if (candidates.length === 0) return false;

  return candidates.some((candidate) =>
    fileExtensions.some((extension) => candidate.endsWith(extension)),
  );
};

export const isDocxFile = (fields: FileTypeFields): boolean =>
  matchesFileType(fields, DOCX_FILE_TYPES, DOCX_FILE_EXTENSIONS);

export const isPdfFile = (fields: FileTypeFields): boolean =>
  matchesFileType(fields, PDF_FILE_TYPES, PDF_FILE_EXTENSIONS);

export const isPptxFile = (fields: FileTypeFields): boolean =>
  matchesFileType(fields, PPTX_FILE_TYPES, PPTX_FILE_EXTENSIONS);

export const isXlsxFile = (fields: FileTypeFields): boolean =>
  matchesFileType(fields, XLSX_FILE_TYPES, XLSX_FILE_EXTENSIONS);
