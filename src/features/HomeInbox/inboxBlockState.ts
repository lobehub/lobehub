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

/**
 * Whether the surface waits on the brief feed. Without needs-you (the rail)
 * nothing reads it before paint: news has its own day feed and only overlays
 * read state from briefs. Blocking there held a skeleton over the rail on every
 * refresh until the persisted feed hydrated.
 */
const isBriefsBlockVisible = (hiddenWidgets: string[], hideNeedsYou?: boolean): boolean =>
  !hideNeedsYou &&
  (isWidgetSectionVisible('needsYou', hiddenWidgets) ||
    isWidgetSectionVisible('news', hiddenWidgets));

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

/**
 * What a viewer the session has not confirmed sees. The page already lays out
 * for the last signed-in user while the session check is in flight, but the
 * feeds and the lab preferences that pick the rail's sections stay network-only
 * until it answers. The rail holds its place with skeletons meanwhile; settling
 * "empty" would fold the page to one column and slide it back once the cards land.
 */
export const resolveSignedOutRailState = ({
  isRail,
  restoringSession,
}: {
  isRail: boolean;
  restoringSession: boolean;
}): 'skeleton' | null => (isRail && restoringSession ? 'skeleton' : null);
