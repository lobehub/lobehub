import dayjs from 'dayjs';
import { useMemo } from 'react';

import { PAGE_FILE_TYPE } from '@/features/ResourceManager/constants';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';

interface UseFileListItemMetaOptions {
  createdAt: Date;
  fileType: string;
  metadata?: {
    emoji?: string | null;
  } | null;
  name?: string | null;
  sourceType?: string | null;
}

export const useFileListItemMeta = ({
  createdAt,
  fileType,
  metadata,
  name,
  sourceType,
}: UseFileListItemMetaOptions) =>
  useMemo(() => {
    const lowerFileType = fileType?.toLowerCase();
    const lowerName = name?.toLowerCase();
    const isPDF = lowerFileType === 'pdf' || lowerName?.endsWith('.pdf');
    const isOfficeFile =
      lowerName?.endsWith('.xls') ||
      lowerName?.endsWith('.xlsx') ||
      lowerName?.endsWith('.doc') ||
      lowerName?.endsWith('.docx') ||
      lowerName?.endsWith('.ppt') ||
      lowerName?.endsWith('.pptx') ||
      lowerName?.endsWith('.odt');

    return {
      displayTime:
        dayjs().diff(dayjs(createdAt), 'd') < 7
          ? dayjs(createdAt).fromNow()
          : dayjs(createdAt).format('YYYY-MM-DD'),
      emoji: sourceType === 'document' || fileType === PAGE_FILE_TYPE ? metadata?.emoji : null,
      isFolder: fileType === 'custom/folder',
      isPage: !isPDF && !isOfficeFile && (sourceType === 'document' || fileType === PAGE_FILE_TYPE),
      isSupportedForChunking: !isChunkingUnsupported(fileType),
    };
  }, [createdAt, fileType, metadata?.emoji, name, sourceType]);
