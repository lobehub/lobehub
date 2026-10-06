import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';

import { SUPPORT_TEXT_LIST } from './file';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './splitter/separators';
import { type FileLoaderType } from './types';

/**
 * Resolve which built-in chunking loader handles a file, by filename.
 * This is the single source of truth `ChunkingLoader.partitionContent` dispatches on:
 * `undefined` means the chunking task is guaranteed to fail.
 */
export const getChunkingLoaderType = (filename: string): FileLoaderType | undefined => {
  const name = filename.toLowerCase();

  if (name.endsWith('pptx')) {
    return 'ppt';
  }

  if (name.endsWith('docx') || name.endsWith('doc')) {
    return 'doc';
  }

  if (name.endsWith('pdf')) {
    return 'pdf';
  }

  if (name.endsWith('tex')) {
    return 'latex';
  }

  if (name.endsWith('md') || name.endsWith('mdx')) {
    return 'markdown';
  }

  if (name.endsWith('csv')) {
    return 'csv';
  }

  if (name.endsWith('epub')) {
    return 'epub';
  }

  if (name.endsWith('ipynb')) {
    return 'ipynb';
  }

  const ext = name.split('.').pop();

  if (ext && SUPPORTED_LANGUAGES.includes(ext as SupportedLanguage)) {
    return 'code';
  }

  if (ext && SUPPORT_TEXT_LIST.includes(ext)) return 'text';
};

/**
 * Whether a file is eligible for chunking. Uses the parser's own registry when the
 * filename is known, and only falls back to the MIME heuristic when it is not.
 */
export const isChunkingSupported = ({
  fileType,
  name,
}: {
  fileType?: string | null;
  name?: string | null;
}): boolean => {
  if (name) return !!getChunkingLoaderType(name);

  return !isChunkingUnsupported(fileType ?? '');
};
