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

// Formats the browser `<audio>` element can play. `.ogg` / `.webm` stay with the
// video renderer unless the MIME type says audio, since they are container formats.
const AUDIO_FILE_EXTENSIONS = ['.aac', '.flac', '.m4a', '.mp3', '.oga', '.opus', '.wav', '.weba'];
const AUDIO_FILE_TYPES = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'opus', 'wav', 'weba']);

export const isAudioFile = ({ fileName, fileType }: Omit<PdfFileFields, 'path'>): boolean => {
  const normalizedFileType = normalizeFileType(fileType);

  if (normalizedFileType) {
    if (normalizedFileType.startsWith('audio/')) return true;
    if (AUDIO_FILE_TYPES.has(normalizedFileType)) return true;
  }

  if (!fileName) return false;

  const candidate = stripUrlSuffix(fileName).toLowerCase();

  return AUDIO_FILE_EXTENSIONS.some((extension) => candidate.endsWith(extension));
};
