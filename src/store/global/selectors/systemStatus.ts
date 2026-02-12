import { type GlobalState } from '../initialState';
import { INITIAL_STATUS } from '../initialState';

export const systemStatus = (s: GlobalState) => s.status;

const agentBuilderPanelWidth = (s: GlobalState) => s.status.agentBuilderPanelWidth || 360;

const sessionGroupKeys = (s: GlobalState): string[] =>
  s.status.expandSessionGroupKeys || INITIAL_STATUS.expandSessionGroupKeys;

const topicGroupKeys = (s: GlobalState): string[] | undefined => s.status.expandTopicGroupKeys;

const topicPageSize = (s: GlobalState): number => s.status.topicPageSize || 20;

const agentPageSize = (s: GlobalState): number => s.status.agentPageSize || 10;

const pagePageSize = (s: GlobalState): number => s.status.pagePageSize || 20;

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
const modelSwitchPanelWidth = (s: GlobalState) => s.status.modelSwitchPanelWidth || 430;
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
const imageTopicPanelWidth = (s: GlobalState) => s.status.imageTopicPanelWidth;
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
  hidePWAInstaller,
  imagePanelWidth,
  imageTopicPanelWidth,
  inZenMode,
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
  sessionGroupKeys,
  showChatHeader,
  showFilePanel,
  showImagePanel,
  showImageTopicPanel,
  showLeftPanel,
  showRightPanel,
  showSystemRole,
  systemStatus,
  tokenDisplayFormatShort,
  topicGroupKeys,
  topicPageSize,
  wideScreen,
};
