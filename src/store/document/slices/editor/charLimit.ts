import { DOCUMENT_CHAR_LIMIT_EXCEEDED, type DocumentCharLimitErrorData } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import i18next, { t } from 'i18next';

/** A save refused by the plan's per-document character limit. */
export interface DocumentCharLimitRefusal {
  actual: number;
  limit: number;
  plan?: string;
}

/**
 * Reads a per-document character limit refusal from a save error.
 *
 * @param fallbackActual - Length of the refused body, used when the server omits it.
 */
export const getCharLimitRefusal = (
  error: unknown,
  fallbackActual: number,
): DocumentCharLimitRefusal | undefined => {
  const data = (error as { data?: { errorData?: Partial<DocumentCharLimitErrorData> } })?.data
    ?.errorData;
  if (data?.code !== DOCUMENT_CHAR_LIMIT_EXCEEDED || typeof data.limit !== 'number') return;

  return { actual: data.actual ?? fallbackActual, limit: data.limit, plan: data.plan };
};

/**
 * Tells the user why a save they asked for (Cmd+S, a save button) did nothing.
 * Autosaves stay quiet and rely on the editor's banner, which may be scrolled
 * out of view when the user saves by hand.
 */
export const notifyCharLimitRefused = ({ actual, limit }: DocumentCharLimitRefusal) => {
  const format = new Intl.NumberFormat(i18next.language);
  toast.error(
    t('pageEditor.charLimit.blockedTitle', {
      actual: format.format(actual),
      limit: format.format(limit),
      ns: 'file',
    }),
  );
};
