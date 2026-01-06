import { ARTIFACT_TAG_CLOSED_REGEX, ARTIFACT_TAG_REGEX } from '@/const/plugin';
import type { ChatStoreState } from '@/store/chat';

import { dbMessageSelectors } from '../message/selectors';

const showPortal = (s: ChatStoreState) => s.showPortal;

const showMessageDetail = (s: ChatStoreState) => !!s.portalMessageDetail;
const messageDetailId = (s: ChatStoreState) => s.portalMessageDetail;

const showPluginUI = (s: ChatStoreState) => !!s.portalToolMessage;

const toolMessageId = (s: ChatStoreState) => s.portalToolMessage?.id;
const isPluginUIOpen = (id: string) => (s: ChatStoreState) =>
  toolMessageId(s) === id && showPortal(s);
const toolUIIdentifier = (s: ChatStoreState) => s.portalToolMessage?.identifier;

const showFilePreview = (s: ChatStoreState) => !!s.portalFile;
const previewFileId = (s: ChatStoreState) => s.portalFile?.fileId;
const chunkText = (s: ChatStoreState) => s.portalFile?.chunkText;

const showNotebook = (s: ChatStoreState) => !!s.showNotebook;

const showDocument = (s: ChatStoreState) => !!s.portalDocumentId;
const portalDocumentId = (s: ChatStoreState) => s.portalDocumentId;

const showArtifactUI = (s: ChatStoreState) => !!s.portalArtifact;
const artifactTitle = (s: ChatStoreState) => s.portalArtifact?.title;
const artifactIdentifier = (s: ChatStoreState) => s.portalArtifact?.identifier || '';
const artifactMessageId = (s: ChatStoreState) => s.portalArtifact?.id;
const artifactType = (s: ChatStoreState) => s.portalArtifact?.type;
const artifactCodeLanguage = (s: ChatStoreState) => s.portalArtifact?.language;

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

/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
export const chatPortalSelectors = {
  isPluginUIOpen,

  previewFileId,
  showFilePreview,
  chunkText,

  messageDetailId,
  showMessageDetail,

  showNotebook,

  showDocument,
  portalDocumentId,

  showPluginUI,
  showPortal,

  toolMessageId,
  toolUIIdentifier,

  showArtifactUI,
  artifactTitle,
  artifactIdentifier,
  artifactMessageId,
  artifactType,
  artifactCode,
  artifactMessageContent,
  artifactCodeLanguage,
  isArtifactTagClosed,
};

export * from './selectors/thread';
