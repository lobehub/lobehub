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
  const name = filename.split(/[/\\]/).at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return;

  const extension = name.slice(dot + 1).toLowerCase();
  switch (extension) {
    case 'csv':
    case 'doc':
    case 'docx':
    case 'epub':
    case 'ipynb':
    case 'pdf': {
      return extension;
    }
    case 'md':
    case 'mdx': {
      return 'markdown';
    }
    case 'pptx': {
      return 'ppt';
    }
    case 'tex': {
      return 'latex';
    }
    case 'xlsx': {
      return 'excel';
    }
  }

  if (SUPPORTED_LANGUAGES.includes(extension as SupportedLanguage)) return 'code';
  if (SUPPORT_TEXT_LIST.includes(extension)) return 'text';
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
