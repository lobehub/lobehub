'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { Maximize2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildAgentDocumentPath } from '@/features/AgentDocumentPage/navigation';
import PortalChromeHeader from '@/features/Portal/components/Header';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import { useResolvedDocumentId } from './documentViewContext';
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

const PortalHeader = memo(() => (
  <PortalChromeHeader rightExtra={<OpenAsPageAction />} title={<DocumentTitle />} />
));

export default PortalHeader;
