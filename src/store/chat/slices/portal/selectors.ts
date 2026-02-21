import { ARTIFACT_TAG_CLOSED_REGEX, ARTIFACT_TAG_REGEX } from '@/const/plugin';
import { type ChatStoreState } from '@/store/chat';
import { type PortalArtifact } from '@/types/artifact';

import { dbMessageSelectors } from '../message/selectors';
import { type PortalFile, type PortalViewData } from './initialState';
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
const showDocument = (s: ChatStoreState) => currentViewType(s) === PortalViewType.Document;
const showNotebook = (s: ChatStoreState) => currentViewType(s) === PortalViewType.Notebook;
const showFilePreview = (s: ChatStoreState) => currentViewType(s) === PortalViewType.FilePreview;
const showMessageDetail = (s: ChatStoreState) =>
  currentViewType(s) === PortalViewType.MessageDetail;
const showPluginUI = (s: ChatStoreState) => currentViewType(s) === PortalViewType.ToolUI;

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

const artifactMessageContent = (id: string) => (s: ChatStoreState) => {
  const message = dbMessageSelectors.getDbMessageById(id)(s);
  return message?.content || '';
};

const artifactCode = (id: string) => (s: ChatStoreState) => {
  const messageContent = artifactMessageContent(id)(s);
  const result = messageContent.match(ARTIFACT_TAG_REGEX);

  let content = result?.groups?.content || '';

  // Remove markdown code block if content is wrapped
  content = content.replace(/^\s*```[^\n]*\n([\S\s]*?)\n```\s*$/, '$1');

  return content;
};

const isArtifactTagClosed = (id: string) => (s: ChatStoreState) => {
  const content = artifactMessageContent(id)(s);

  return ARTIFACT_TAG_CLOSED_REGEX.test(content || '');
};

// Document selectors
const portalDocumentId = (s: ChatStoreState): string | undefined => {
  const view = getViewData(s, PortalViewType.Document);
  return view?.documentId;
};

// File Preview selectors
const currentFile = (s: ChatStoreState): PortalFile | undefined => {
  const view = getViewData(s, PortalViewType.FilePreview);
  return view?.file;
};

const previewFileId = (s: ChatStoreState) => currentFile(s)?.fileId;
const chunkText = (s: ChatStoreState) => currentFile(s)?.chunkText;

// Message Detail selectors
const messageDetailId = (s: ChatStoreState): string | undefined => {
  const view = getViewData(s, PortalViewType.MessageDetail);
  return view?.messageId;
};

// Tool UI / Plugin selectors
const currentToolUI = (
  s: ChatStoreState,
): { identifier: string; messageId: string } | undefined => {
  const view = getViewData(s, PortalViewType.ToolUI);
  if (view) {
    return { identifier: view.identifier, messageId: view.messageId };
  }
  return undefined;
};

const toolMessageId = (s: ChatStoreState) => currentToolUI(s)?.messageId;
const toolUIIdentifier = (s: ChatStoreState) => currentToolUI(s)?.identifier;
const isPluginUIOpen = (id: string) => (s: ChatStoreState) =>
  toolMessageId(s) === id && showPortal(s);

/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
export const chatPortalSelectors = {
  // Core stack selectors
  currentView,
  currentViewType,
  canGoBack,
  stackDepth,
  showPortal,

  // View type guards
  showArtifactUI,
  showDocument,
  showNotebook,
  showFilePreview,
  showMessageDetail,
  showPluginUI,

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
  portalDocumentId,

  // File preview data
  currentFile,
  previewFileId,
  chunkText,

  // Message detail data
  messageDetailId,

  // Tool UI data
  currentToolUI,
  toolMessageId,
  toolUIIdentifier,
  isPluginUIOpen,
};

export * from './selectors/thread';
