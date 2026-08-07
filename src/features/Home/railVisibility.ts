import { hasVisibleRailWidget } from '@/features/HomeInbox/hiddenWidgets';

export const RAIL_INBOX_PROPS = { hideNeedsYou: true, hideUnread: true } as const;

interface RailVisibilityInput {
  hiddenWidgets: string[];
  isLogin?: boolean | null;
  showHomeRail?: boolean;
}

export const canHostRail = (hiddenWidgets: string[]): boolean =>
  hasVisibleRailWidget({ ...RAIL_INBOX_PROPS, hiddenWidgets });

export const resolveRailVisibility = ({
  hiddenWidgets,
  isLogin,
  showHomeRail,
}: RailVisibilityInput): boolean => Boolean(isLogin && showHomeRail && canHostRail(hiddenWidgets));
