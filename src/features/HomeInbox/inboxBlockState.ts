import { isWidgetSectionVisible } from '@/features/Home/CustomizeModal/config';

export type InboxBlockState = 'error' | 'skeleton' | null;

interface InboxBlockStateInput {
  hasError: boolean;
  hiddenWidgets: string[];
  hideNeedsYou?: boolean;
  isBriefsInit: boolean;
  isLoading: boolean;
  isMain?: boolean;
}

const isBriefsBlockVisible = (hiddenWidgets: string[], hideNeedsYou?: boolean): boolean =>
  (!hideNeedsYou && isWidgetSectionVisible('needsYou', hiddenWidgets)) ||
  isWidgetSectionVisible('news', hiddenWidgets);

export const resolveInboxBlockState = ({
  hasError,
  hiddenWidgets,
  hideNeedsYou,
  isBriefsInit,
  isLoading,
  isMain,
}: InboxBlockStateInput): InboxBlockState => {
  if (isMain) return null;
  if (!isBriefsBlockVisible(hiddenWidgets, hideNeedsYou)) return null;
  if (isBriefsInit) return null;

  return hasError && !isLoading ? 'error' : 'skeleton';
};
