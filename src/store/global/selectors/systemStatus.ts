import { type GlobalState } from '../initialState';
import { INITIAL_STATUS } from '../initialState';

export const systemStatus = (s: GlobalState) => s.status;

const agentBuilderPanelWidth = (s: GlobalState) => s.status.agentBuilderPanelWidth || 360;

const sessionGroupKeys = (s: GlobalState): string[] =>
  s.status.expandSessionGroupKeys || INITIAL_STATUS.expandSessionGroupKeys;

const topicGroupKeys = (s: GlobalState): string[] | undefined => s.status.expandTopicGroupKeys;

const topicPageSize = (s: GlobalState): number => s.status.topicPageSize || 20;

const agentPageSize = (s: GlobalState): number => s.status.agentPageSize || 5;

const recentPageSize = (s: GlobalState): number => s.status.recentPageSize || 5;

const pagePageSize = (s: GlobalState): number => s.status.pagePageSize || 20;

export const DEFAULT_HIDDEN_SECTIONS: string[] = ['memory'];

const hiddenSidebarSections = (s: GlobalState): string[] =>
  s.status.hiddenSidebarSections ?? DEFAULT_HIDDEN_SECTIONS;

export const DEFAULT_SIDEBAR_ITEMS: string[] = [
  'pages',
  'recents',
  'agent',
  'community',
  'resource',
  'memory',
];

/** Items that must stay contiguous in the sidebar list (accordion block). */
export const SIDEBAR_ACCORDION_KEYS = new Set(['recents', 'agent']);

/** Append any known keys missing from `order` so new items don't disappear on upgrade. */
const withAllKnownKeys = (order: string[]): string[] => {
  const present = new Set(order);
  const missing = DEFAULT_SIDEBAR_ITEMS.filter((k) => !present.has(k));
  return missing.length === 0 ? order : [...order, ...missing];
};

const accordionIndices = (items: string[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (SIDEBAR_ACCORDION_KEYS.has(items[i])) out.push(i);
  }
  return out;
};

/**
 * Reorder sidebar items while keeping the accordion block (recents + agent) contiguous.
 * - If moving an accordion item across the block boundary, moves the whole block.
 * - If moving a non-accordion item into the middle of the block, snaps it to the side
 *   matching the drag direction.
 */
export const reorderSidebarItems = (items: string[], from: number, to: number): string[] => {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }

  const key = items[from];
  const accIdx = accordionIndices(items);

  // Moving an accordion item across the block's outer boundary → move whole block together.
  if (SIDEBAR_ACCORDION_KEYS.has(key) && accIdx.length >= 2) {
    const first = accIdx[0];
    const last = accIdx.at(-1)!;
    const crossesBoundary = (from === first && to < first) || (from === last && to > last);
    if (crossesBoundary) {
      const block = items.slice(first, last + 1);
      const without = [...items.slice(0, first), ...items.slice(last + 1)];
      // After removing the block, adjust target index for upward/downward movement
      const targetIdx = to < first ? to : to - (last - first + 1) + 1;
      const clamped = Math.max(0, Math.min(without.length, targetIdx));
      return [...without.slice(0, clamped), ...block, ...without.slice(clamped)];
    }
  }

  // Standard reorder
  const moved = [...items];
  const [removed] = moved.splice(from, 1);
  moved.splice(to, 0, removed);

  // Non-accordion item that landed between accordion items → snap to the side matching drag direction.
  if (!SIDEBAR_ACCORDION_KEYS.has(key)) {
    const nextAcc = accordionIndices(moved);
    if (nextAcc.length >= 2) {
      const first = nextAcc[0];
      const last = nextAcc.at(-1)!;
      const contiguous = last - first === nextAcc.length - 1;
      if (!contiguous) {
        const pos = moved.indexOf(key);
        if (pos > first && pos < last) {
          const cleaned = [...moved];
          cleaned.splice(pos, 1);
          const cAcc = accordionIndices(cleaned);
          const insertAt = from < to ? cAcc.at(-1)! + 1 : cAcc[0];
          cleaned.splice(insertAt, 0, key);
          return cleaned;
        }
      }
    }
  }

  return moved;
};

const sidebarItems = (s: GlobalState): string[] => {
  const items = s.status.sidebarItems;
  if (items && items.length > 0) return withAllKnownKeys(items);

  // Migrate from the legacy `sidebarSectionOrder` (canary) which only stored the
  // accordion order (e.g. ['agent', 'recents']). Apply that order to the accordion
  // slot inside the default list so users keep their custom accordion arrangement.
  const legacy = s.status.sidebarSectionOrder;
  if (legacy && legacy.length > 0) {
    const legacyAcc = legacy.filter((k) => SIDEBAR_ACCORDION_KEYS.has(k));
    if (legacyAcc.length > 0) {
      const seen = new Set<string>();
      const merged: string[] = [];
      for (const k of DEFAULT_SIDEBAR_ITEMS) {
        if (SIDEBAR_ACCORDION_KEYS.has(k)) {
          for (const lk of legacyAcc) {
            if (!seen.has(lk)) {
              merged.push(lk);
              seen.add(lk);
            }
          }
        } else if (!seen.has(k)) {
          merged.push(k);
          seen.add(k);
        }
      }
      return withAllKnownKeys(merged);
    }
  }

  return DEFAULT_SIDEBAR_ITEMS;
};
const showSystemRole = (s: GlobalState) => s.status.showSystemRole;
const mobileShowTopic = (s: GlobalState) => s.status.mobileShowTopic;
const mobileShowPortal = (s: GlobalState) => s.status.mobileShowPortal;
const showRightPanel = (s: GlobalState) => !s.status.zenMode && s.status.showRightPanel;
const showLeftPanel = (s: GlobalState) => !s.status.zenMode && s.status.showLeftPanel;
const showFilePanel = (s: GlobalState) => s.status.showFilePanel;
const showImagePanel = (s: GlobalState) => s.status.showImagePanel;
const showImageTopicPanel = (s: GlobalState) => s.status.showImageTopicPanel;
const hidePWAInstaller = (s: GlobalState) => s.status.hidePWAInstaller;
const isShowCredit = (s: GlobalState) => s.status.isShowCredit;
const language = (s: GlobalState) => s.status.language || 'auto';
const modelSwitchPanelGroupMode = (s: GlobalState) =>
  s.status.modelSwitchPanelGroupMode || 'byProvider';
const modelSwitchPanelWidth = (s: GlobalState) => s.status.modelSwitchPanelWidth || 460;
const pageAgentPanelWidth = (s: GlobalState) => s.status.pageAgentPanelWidth || 360;

const showChatHeader = (s: GlobalState) => !s.status.zenMode;
const inZenMode = (s: GlobalState) => s.status.zenMode;
const leftPanelWidth = (s: GlobalState): number => {
  const width = s.status.leftPanelWidth;
  return typeof width === 'string' ? Number.parseInt(width) : width;
};
const portalWidth = (s: GlobalState) => s.status.portalWidth || 400;
const filePanelWidth = (s: GlobalState) => s.status.filePanelWidth;
const groupAgentBuilderPanelWidth = (s: GlobalState) => s.status.groupAgentBuilderPanelWidth || 360;
const imagePanelWidth = (s: GlobalState) => s.status.imagePanelWidth;
const imageTopicViewMode = (s: GlobalState) => s.status.imageTopicViewMode || 'grid';
const imageTopicPanelWidth = (s: GlobalState) => s.status.imageTopicPanelWidth;
const videoPanelWidth = (s: GlobalState) => s.status.videoPanelWidth;
const videoTopicViewMode = (s: GlobalState) => s.status.videoTopicViewMode || 'grid';
const videoTopicPanelWidth = (s: GlobalState) => s.status.videoTopicPanelWidth;
const showVideoPanel = (s: GlobalState) => s.status.showVideoPanel;
const showVideoTopicPanel = (s: GlobalState) => s.status.showVideoTopicPanel;
const wideScreen = (s: GlobalState) => !s.status.noWideScreen;
const chatInputHeight = (s: GlobalState) => s.status.chatInputHeight || 64;
const expandInputActionbar = (s: GlobalState) => s.status.expandInputActionbar;
const isStatusInit = (s: GlobalState) => !!s.isStatusInit;

const getAgentSystemRoleExpanded =
  (agentId: string) =>
  (s: GlobalState): boolean => {
    const map = s.status.systemRoleExpandedMap || {};
    return map[agentId] === true; // System role is collapsed by default
  };

const disabledModelProvidersSortType = (s: GlobalState) =>
  s.status.disabledModelProvidersSortType || 'default';
const disabledModelsSortType = (s: GlobalState) => s.status.disabledModelsSortType || 'default';

const isNotificationRead =
  (slug: string) =>
  (s: GlobalState): boolean => {
    const slugs = s.status.readNotificationSlugs || [];
    return slugs.includes(slug);
  };

const isBannerDismissed =
  (bannerId: string) =>
  (s: GlobalState): boolean => {
    const ids = s.status.dismissedBannerIds || [];
    return ids.includes(bannerId);
  };
const tokenDisplayFormatShort = (s: GlobalState) =>
  s.status.tokenDisplayFormatShort !== undefined ? s.status.tokenDisplayFormatShort : true;

export const systemStatusSelectors = {
  agentBuilderPanelWidth,
  agentPageSize,
  chatInputHeight,
  disabledModelProvidersSortType,
  disabledModelsSortType,
  expandInputActionbar,
  filePanelWidth,
  getAgentSystemRoleExpanded,
  groupAgentBuilderPanelWidth,
  hiddenSidebarSections,
  hidePWAInstaller,
  imagePanelWidth,
  imageTopicViewMode,
  imageTopicPanelWidth,
  inZenMode,
  isBannerDismissed,
  isNotificationRead,
  isShowCredit,
  isStatusInit,
  language,
  leftPanelWidth,
  mobileShowPortal,
  mobileShowTopic,
  modelSwitchPanelGroupMode,
  modelSwitchPanelWidth,
  pageAgentPanelWidth,
  pagePageSize,
  portalWidth,
  recentPageSize,
  sidebarItems,
  sessionGroupKeys,
  showChatHeader,
  showFilePanel,
  showImagePanel,
  showImageTopicPanel,
  showLeftPanel,
  showRightPanel,
  showSystemRole,
  showVideoPanel,
  showVideoTopicPanel,
  systemStatus,
  tokenDisplayFormatShort,
  topicGroupKeys,
  topicPageSize,
  videoPanelWidth,
  videoTopicViewMode,
  videoTopicPanelWidth,
  wideScreen,
};
