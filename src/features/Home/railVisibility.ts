import { hasVisibleRailWidget } from '@/features/HomeInbox/hiddenWidgets';
import type { RailContentState } from '@/features/HomeInbox/railContentState';

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

/**
 * The rail hands its space to the main column when it settled empty, and —
 * while its feeds are still loading — when it settled empty last time in this
 * scope. Without that memory every reload of an empty rail painted skeletons
 * beside a narrowed page, then slid the page back once the feeds answered.
 */
export const resolveRailEmpty = (state: RailContentState, emptyLastTime: boolean): boolean =>
  state === 'empty' || (state === 'pending' && emptyLastTime);
