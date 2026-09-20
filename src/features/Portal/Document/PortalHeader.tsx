'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { Maximize2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildAgentDocumentPath,
  buildAgentDocumentsPath,
} from '@/features/AgentDocumentPage/navigation';
import PortalChromeHeader from '@/features/Portal/components/Header';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import { useResolvedAgentDocumentId, useResolvedDocumentId } from './documentViewContext';
import DocumentTitle from './Header';

/**
 * Expands the in-chat document portal into the full-page document route, then
 * collapses the portal so returning to chat lands on a clean conversation.
 */
const OpenAsPageAction = memo(() => {
  const { t } = useTranslation('chat');
  const documentId = useResolvedDocumentId();
  const agentId = useAgentStore((s) => s.activeAgentId);
  const navigate = useWorkspaceAwareNavigate();
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  if (!documentId || !agentId) return null;

  return (
    <ActionIcon
      icon={Maximize2Icon}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={t('agentDocument.openAsPage')}
      onClick={() => {
        navigate(buildAgentDocumentPath(agentId, documentId));
        clearPortalStack();
      }}
    />
  );
});

const PortalHeader = () => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  // Discriminate on the resolved agent-documents binding, not `agentId` alone:
  // a plain notebook document can be open while an agent happens to be active,
  // and that agent's index is not this document's home.
  const agentDocumentId = useResolvedAgentDocumentId();
  const navigate = useWorkspaceAwareNavigate();

  // Agent documents have a documents index to land on; plain notebook
  // documents keep a non-navigating crumb label.
  const openDocumentsIndex =
    agentId && agentDocumentId ? () => navigate(buildAgentDocumentsPath(agentId)) : undefined;

  return (
    <PortalChromeHeader
      rightExtra={<OpenAsPageAction />}
      title={<DocumentTitle onOpenDocumentsIndex={openDocumentsIndex} />}
    />
  );
};

export default PortalHeader;
