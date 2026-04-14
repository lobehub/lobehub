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

const ALL_SIDEBAR_KEYS = ['pages', 'recents', 'agent', 'community', 'resource', 'memory'];
const ACCORDION_KEYS = new Set(['recents', 'agent']);

export const DEFAULT_ZONES: SidebarZones = {
  bottom: ['community', 'resource', 'memory'],
  middle: ['recents', 'agent'],
  top: ['pages'],
};

export interface SidebarZones {
  bottom: string[];
  middle: string[];
  top: string[];
}

/** Derive zones from a legacy flat order based on accordion item positions. */
const deriveZonesFromOrder = (order: string[]): SidebarZones => {
  let firstAcc = -1;
  let lastAcc = -1;
  for (let i = 0; i < order.length; i++) {
    if (ACCORDION_KEYS.has(order[i])) {
      if (firstAcc === -1) firstAcc = i;
      lastAcc = i;
    }
  }
  if (firstAcc === -1) return { bottom: [], middle: [], top: [...order] };
  return {
    bottom: order.slice(lastAcc + 1),
    middle: order.slice(firstAcc, lastAcc + 1),
    top: order.slice(0, firstAcc),
  };
};

const sidebarZones = (s: GlobalState): SidebarZones => {
  const zones = s.status.sidebarZones;
  if (zones && zones.top && zones.middle && zones.bottom) {
    // Ensure all known items are present (handles future additions)
    const present = new Set([...zones.top, ...zones.middle, ...zones.bottom]);
    const missing = ALL_SIDEBAR_KEYS.filter((k) => !present.has(k));
    if (missing.length === 0) return zones;
    return { ...zones, bottom: [...zones.bottom, ...missing] };
  }

  // Migration from legacy sidebarSectionOrder
  const legacy = s.status.sidebarSectionOrder;
  if (legacy && legacy.length > 0) {
    // Derive zones from the keys the user explicitly ordered
    const zones = deriveZonesFromOrder(legacy);

    // Seed missing keys into their default zone so new items (e.g. pages)
    // land in the correct zone instead of being blindly appended.
    const present = new Set([...zones.top, ...zones.middle, ...zones.bottom]);
    for (const zone of ['top', 'middle', 'bottom'] as const) {
      const missing = DEFAULT_ZONES[zone].filter((k) => !present.has(k));
      if (missing.length > 0) {
        zones[zone] = [...zones[zone], ...missing];
      }
    }

    return zones;
  }

  return DEFAULT_ZONES;
};

/** Flat order derived from zones — for consumers that need a single array. */
const sidebarSectionOrder = (s: GlobalState): string[] => {
  const z = sidebarZones(s);
  return [...z.top, ...z.middle, ...z.bottom];
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
  sidebarSectionOrder,
  sidebarZones,
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
