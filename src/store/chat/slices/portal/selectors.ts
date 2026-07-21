import { ARTIFACT_TAG_CLOSED_REGEX, ARTIFACT_TAG_REGEX } from '@/const/plugin';
import { type ChatStoreState } from '@/store/chat';
import { type PortalArtifact } from '@/types/artifact';

import { dbMessageSelectors } from '../message/selectors';
import { topicSelectors } from '../topic/selectors';
import { createLocalFileScopeKey, getLocalFileTabId } from './helpers';
import { type OpenLocalFileEntry, type PortalFile, type PortalViewData } from './initialState';
import { PortalViewType } from './initialState';

// ============== Core Stack Selectors ==============

const currentView = (s: ChatStoreState): PortalViewData | null => {
  const { portalStack } = s;
  return portalStack.at(-1) ?? null;
};

const currentViewType = (s: ChatStoreState): PortalViewType | null => {
  return currentView(s)?.type ?? null;
};

const canGoBack = (s: ChatStoreState): boolean => {
  return s.portalStack.length > 1;
};

const stackDepth = (s: ChatStoreState): number => {
  return s.portalStack.length;
};

const showPortal = (s: ChatStoreState) => s.showPortal;

// ============== View Type Guards ==============

const showArtifactUI = (s: ChatStoreState) => currentViewType(s) === PortalViewType.Artifact;
const showAgentDetail = (s: ChatStoreState) => currentViewType(s) === PortalViewType.AgentDetail;
const showDocument = (s: ChatStoreState) => currentViewType(s) === PortalViewType.Document;
const showNotebook = (s: ChatStoreState) => currentViewType(s) === PortalViewType.Notebook;
const showFilePreview = (s: ChatStoreState) => currentViewType(s) === PortalViewType.FilePreview;
const showLocalFile = (s: ChatStoreState) => currentViewType(s) === PortalViewType.LocalFile;
const showMessageDetail = (s: ChatStoreState) =>
  currentViewType(s) === PortalViewType.MessageDetail;
const showPluginUI = (s: ChatStoreState) => currentViewType(s) === PortalViewType.ToolUI;
const showTaskDetail = (s: ChatStoreState) => currentViewType(s) === PortalViewType.TaskDetail;

// ============== Data Extractors ==============

// Helper to extract data from current view
const getViewData = <T extends PortalViewType>(
  s: ChatStoreState,
  type: T,
): Extract<PortalViewData, { type: T }> | null => {
  const view = currentView(s);
  if (view?.type === type) {
    return view as Extract<PortalViewData, { type: T }>;
  }
  return null;
};

const agentDetailId = (s: ChatStoreState): string | undefined => {
  const view = getViewData(s, PortalViewType.AgentDetail);
  return view?.agentId;
};

// Artifact selectors
const currentArtifact = (s: ChatStoreState): PortalArtifact | undefined => {
  const view = getViewData(s, PortalViewType.Artifact);
  return view?.artifact;
};

const artifactTitle = (s: ChatStoreState) => currentArtifact(s)?.title;
const artifactIdentifier = (s: ChatStoreState) => currentArtifact(s)?.identifier || '';
const artifactMessageId = (s: ChatStoreState) => currentArtifact(s)?.id;
const artifactType = (s: ChatStoreState) => currentArtifact(s)?.type;
const artifactCodeLanguage = (s: ChatStoreState) => currentArtifact(s)?.language;

// Escape special regex characters in a string
const escapeRegExp = (str: string) => str.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
const CODE_FENCE_START_REGEX = /^\s*```[^\n]*(?:\n|$)/;
const CODE_FENCE_END_REGEX = /\n```\s*$/;

const unwrapArtifactCodeBlock = (content: string) => {
  if (!CODE_FENCE_START_REGEX.test(content)) return content;

  return content.replace(CODE_FENCE_START_REGEX, '').replace(CODE_FENCE_END_REGEX, '');
};

const artifactMessageContent = (id: string) => (s: ChatStoreState) => {
  const message = dbMessageSelectors.getDbMessageById(id)(s);
  return message?.content || '';
};

const artifactCode = (id: string, identifier?: string) => (s: ChatStoreState) => {
  const messageContent = artifactMessageContent(id)(s);

  const regex = identifier
    ? new RegExp(
        `<lobeArtifact\\b[^>]*identifier="${escapeRegExp(identifier)}"[^>]*>(?<content>[\\S\\s]*?)(?:<\\/lobeArtifact>|$)`,
      )
    : ARTIFACT_TAG_REGEX;

  const result = messageContent.match(regex);
  let content = result?.groups?.content || '';

  content = unwrapArtifactCodeBlock(content);

  return content;
};

const isArtifactTagClosed = (id: string, identifier?: string) => (s: ChatStoreState) => {
  const content = artifactMessageContent(id)(s);

  if (identifier) {
    // Check if the specific artifact (by identifier) is closed
    const regex = new RegExp(
      `<lobeArtifact\\b[^>]*identifier="${escapeRegExp(identifier)}"[^>]*>[\\S\\s]*?<\\/lobeArtifact>`,
    );
    return regex.test(content || '');
  }

  return ARTIFACT_TAG_CLOSED_REGEX.test(content || '');
};

// Document selectors
const portalDocumentId = (s: ChatStoreState): string | undefined => {
  const view = getViewData(s, PortalViewType.Document);
  return view?.documentId;
};

const portalAgentDocumentId = (s: ChatStoreState): string | undefined => {
  const view = getViewData(s, PortalViewType.Document);
  return view?.agentDocumentId;
};

// File Preview selectors
const currentFile = (s: ChatStoreState): PortalFile | undefined => {
  const view = getViewData(s, PortalViewType.FilePreview);
  return view?.file;
};

const previewFileId = (s: ChatStoreState) => currentFile(s)?.fileId;
const chunkText = (s: ChatStoreState) => currentFile(s)?.chunkText;

// Local File selectors
const currentLocalFileScopeWorkingDirectory = (s: ChatStoreState): string | undefined =>
  s.topicDataMap ? topicSelectors.currentTopicWorkingDirectory(s) : undefined;

const currentLocalFileScopeKey = (s: ChatStoreState): string | undefined => {
  const workingDirectory = currentLocalFileScopeWorkingDirectory(s);
  return workingDirectory ? createLocalFileScopeKey(workingDirectory) : undefined;
};

const isLocalFileInCurrentScope = (s: ChatStoreState, file: OpenLocalFileEntry): boolean => {
  if (file.allowExternalFilePreview) return true;

  const workingDirectory = currentLocalFileScopeWorkingDirectory(s);
  return workingDirectory ? file.workingDirectory === workingDirectory : true;
};

const openLocalFiles = (s: ChatStoreState): OpenLocalFileEntry[] =>
  (s.openLocalFiles ?? []).filter((file) => isLocalFileInCurrentScope(s, file));

const activeLocalFileId = (s: ChatStoreState): string | undefined => {
  const files = openLocalFiles(s);
  const scopeKey = currentLocalFileScopeKey(s);
  const scopedActiveId = scopeKey ? s.activeLocalFileIdsByScope?.[scopeKey] : s.activeLocalFileId;

  if (scopedActiveId && files.some((file) => getLocalFileTabId(file) === scopedActiveId)) {
    return scopedActiveId;
  }

  const active = s.activeLocalFilePath;
  if (!active) return undefined;

  const file = files.find((item) => item.filePath === active);
  if (file) return getLocalFileTabId(file);

  return scopeKey && files[0] ? getLocalFileTabId(files[0]) : undefined;
};

const activeLocalFilePath = (s: ChatStoreState): string | undefined =>
  currentLocalFile(s)?.filePath ??
  (currentLocalFileScopeWorkingDirectory(s) ? undefined : s.activeLocalFilePath);

const currentLocalFile = (s: ChatStoreState): OpenLocalFileEntry | undefined => {
  const active = activeLocalFileId(s);
  if (!active) return undefined;
  const files = openLocalFiles(s);
  return (
    files.find((f) => getLocalFileTabId(f) === active) ?? files.find((f) => f.filePath === active)
  );
};

const localFilePath = (s: ChatStoreState) => currentLocalFile(s)?.filePath;
const localFileWorkingDirectory = (s: ChatStoreState) => currentLocalFile(s)?.workingDirectory;

// Edit buffers are keyed by tab identity (device + working directory + path),
// so callers pass the tab id rather than a bare file path.
const localFileBuffer =
  (tabId: string | undefined) =>
  (s: ChatStoreState): string | undefined =>
    tabId ? s.dirtyLocalFileContents[tabId] : undefined;

const isLocalFileDirty =
  (tabId: string | undefined) =>
  (s: ChatStoreState): boolean =>
    !!tabId && tabId in s.dirtyLocalFileContents;

const dirtyLocalFileContents = (s: ChatStoreState): Record<string, string> =>
  s.dirtyLocalFileContents;

// Message Detail selectors
const messageDetailId = (s: ChatStoreState): string | undefined => {
  const view = getViewData(s, PortalViewType.MessageDetail);
  return view?.messageId;
};

// Task Detail selectors
const taskDetailId = (s: ChatStoreState): string | undefined => {
  const view = getViewData(s, PortalViewType.TaskDetail);
  return view?.taskId;
};

// Tool UI / Plugin selectors
const currentToolUI = (
  s: ChatStoreState,
): { identifier: string; messageId: string; params?: Record<string, any> } | undefined => {
  const view = getViewData(s, PortalViewType.ToolUI);
  if (view) {
    return { identifier: view.identifier, messageId: view.messageId, params: view.params };
  }
  return undefined;
};

const toolMessageId = (s: ChatStoreState) => currentToolUI(s)?.messageId;
const toolUIIdentifier = (s: ChatStoreState) => currentToolUI(s)?.identifier;
const toolUIParams = (s: ChatStoreState) => currentToolUI(s)?.params;

const currentVerifyResult = (s: ChatStoreState) => getViewData(s, PortalViewType.VerifyResult);
const verifyResultOperationId = (s: ChatStoreState) => currentVerifyResult(s)?.operationId;
const verifyResultCheckItemId = (s: ChatStoreState) => currentVerifyResult(s)?.checkItemId;
const verifyReportRunId = (s: ChatStoreState) => getViewData(s, PortalViewType.VerifyReport)?.runId;
const acceptancePortalId = (s: ChatStoreState) =>
  getViewData(s, PortalViewType.Acceptance)?.acceptanceId;
const isPluginUIOpen = (id: string) => (s: ChatStoreState) =>
  toolMessageId(s) === id && showPortal(s);

export const chatPortalSelectors = {
  // Core stack selectors
  currentView,
  currentViewType,
  canGoBack,
  stackDepth,
  showPortal,

  // View type guards
  showArtifactUI,
  showAgentDetail,
  showDocument,
  showNotebook,
  showFilePreview,
  showLocalFile,
  showMessageDetail,
  showPluginUI,
  showTaskDetail,

  // Agent detail data
  agentDetailId,

  // Artifact data
  currentArtifact,
  artifactTitle,
  artifactIdentifier,
  artifactMessageId,
  artifactType,
  artifactCodeLanguage,
  artifactCode,
  artifactMessageContent,
  isArtifactTagClosed,

  // Document data
  portalAgentDocumentId,
  portalDocumentId,

  // File preview data
  currentFile,
  previewFileId,
  chunkText,

  // Local file data
  activeLocalFileId,
  activeLocalFilePath,
  currentLocalFile,
  dirtyLocalFileContents,
  isLocalFileDirty,
  localFileBuffer,
  localFilePath,
  localFileWorkingDirectory,
  openLocalFiles,

  // Message detail data
  messageDetailId,

  // Task detail data
  taskDetailId,

  // Tool UI data
  currentToolUI,
  toolMessageId,
  toolUIIdentifier,
  toolUIParams,
  isPluginUIOpen,

  // Verify result detail data
  verifyResultOperationId,
  verifyResultCheckItemId,
  verifyReportRunId,

  // Acceptance data
  acceptancePortalId,
};

export * from './selectors/thread';
