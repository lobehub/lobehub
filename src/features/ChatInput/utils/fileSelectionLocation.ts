import type { ContextSelectionPageRange } from '@lobechat/types';
import type { TFunction } from 'i18next';

interface FileSelectionLocationInput {
  pageRange?: ContextSelectionPageRange;
  /** The file name. */
  title?: string;
}

/**
 * Where a file selection came from, such as `paper.pdf · p. 3`, for the
 * composer chip and the sent message.
 */
export const getFileSelectionLocation = (
  { pageRange, title }: FileSelectionLocationInput,
  t: TFunction<'chat'>,
): string => {
  let pages: string | undefined;

  if (pageRange) {
    const { endPage, startPage } = pageRange;
    pages =
      endPage === undefined || endPage === startPage
        ? t('contextSelection.file.page', { page: startPage })
        : t('contextSelection.file.pages', { end: endPage, start: startPage });
  }

  return [title, pages].filter(Boolean).join(' · ');
};
