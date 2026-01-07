import { type GlobalState, INITIAL_STATUS } from '../initialState';

export const systemStatus = (s: GlobalState) => s.status;

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

const showChatHeader = (s: GlobalState) => !s.status.zenMode;
const inZenMode = (s: GlobalState) => s.status.zenMode;
const leftPanelWidth = (s: GlobalState) => s.status.leftPanelWidth;
const portalWidth = (s: GlobalState) => s.status.portalWidth || 400;
const filePanelWidth = (s: GlobalState) => s.status.filePanelWidth;
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
    return map[agentId] === true; // 角色设定默认为折叠状态
  };

const disabledModelProvidersSortType = (s: GlobalState) =>
  s.status.disabledModelProvidersSortType || 'default';
const disabledModelsSortType = (s: GlobalState) => s.status.disabledModelsSortType || 'default';
const tokenDisplayFormatShort = (s: GlobalState) =>
  s.status.tokenDisplayFormatShort !== undefined ? s.status.tokenDisplayFormatShort : true;

export const systemStatusSelectors = {
  agentPageSize,
  chatInputHeight,
  disabledModelProvidersSortType,
  disabledModelsSortType,
  expandInputActionbar,
  filePanelWidth,
  getAgentSystemRoleExpanded,
  hidePWAInstaller,
  imagePanelWidth,
  imageTopicPanelWidth,
  inZenMode,
  isShowCredit,
  isStatusInit,
  language,
  leftPanelWidth,
  mobileShowPortal,
  mobileShowTopic,
  modelSwitchPanelGroupMode,
  modelSwitchPanelWidth,
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
