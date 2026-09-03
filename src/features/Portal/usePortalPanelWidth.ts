import { CHAT_PORTAL_MAX_WIDTH } from '@/const/layoutTokens';
import type { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { getPortalViewMinWidth, getPortalViewWidth, portalWidthStorageKey } from './portalWidth';

/**
 * Shared width state for every surface that hosts the Portal in a right-hand
 * panel: the same per-view min/default widths and drag persistence. Pass a
 * `scope` (e.g. 'goal') so the surface remembers its widths independently of
 * the chat conversation; scoped surfaces also ignore the chat legacy width.
 */
export const usePortalPanelWidth = (viewType?: PortalViewType | null, scope?: string) => {
  const [legacyWidth, portalWidths, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.portalWidth(s),
    systemStatusSelectors.portalWidths(s),
    s.updateSystemStatus,
  ]);

  const width = getPortalViewWidth({
    legacyWidth: scope ? undefined : legacyWidth,
    scope,
    viewType,
    widths: portalWidths,
  });

  const updateWidth = (next?: string | number) => {
    const parsed = typeof next === 'string' ? Number.parseInt(next) : next;
    if (!parsed || parsed === width) return;
    // updateSystemStatus deep-merges, so the other views keep their widths
    updateSystemStatus({ portalWidths: { [portalWidthStorageKey(viewType, scope)]: parsed } });
  };

  return {
    maxWidth: CHAT_PORTAL_MAX_WIDTH,
    minWidth: getPortalViewMinWidth(viewType),
    updateWidth,
    width,
  };
};
