import { hasVisibleRailWidget } from '@/features/HomeInbox/hiddenWidgets';

export const RAIL_INBOX_PROPS = {
  hideNeedsYou: true,
  hideRunning: true,
  hideUnread: true,
} as const;

interface RailVisibilityInput {
  hiddenWidgets: string[];
  isLogin?: boolean | null;
  showHomeRail?: boolean;
  usageActive?: boolean;
}

export const canHostRail = (hiddenWidgets: string[], usageActive?: boolean): boolean =>
  hasVisibleRailWidget({ ...RAIL_INBOX_PROPS, hiddenWidgets, usageActive });

export const resolveRailVisibility = ({
  hiddenWidgets,
  isLogin,
  showHomeRail,
  usageActive,
}: RailVisibilityInput): boolean =>
  Boolean(isLogin && showHomeRail && canHostRail(hiddenWidgets, usageActive));
