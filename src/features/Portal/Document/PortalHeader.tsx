'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { Maximize2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildAgentDocumentsPath } from '@/features/AgentDocumentPage/navigation';
import PortalChromeHeader from '@/features/Portal/components/Header';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import AutoSaveHint from './AutoSaveHint';
import { useResolvedAgentDocumentId } from './documentViewContext';
import DocumentTitle from './Header';
import { usePortalDocumentTitleState } from './titleContext';
import { usePortalDocumentHeaderActions } from './usePortalDocumentHeader';

/**
 * Expands the in-chat document portal into the full-page document route, then
 * collapses the portal so returning to chat lands on a clean conversation.
 */
const OpenAsPageAction = memo(() => {
  const { t } = useTranslation('chat');
  const { path } = usePortalDocumentHeaderActions();
  const navigate = useWorkspaceAwareNavigate();
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  if (!path) return null;

  return (
    <ActionIcon
      icon={Maximize2Icon}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={t('agentDocument.openAsPage')}
      onClick={() => {
        navigate(path);
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
  const { isLoading, metaLocked } = usePortalDocumentTitleState();

  // Agent documents have a documents index to land on; plain notebook
  // documents keep a non-navigating crumb label.
  const openDocumentsIndex =
    agentId && agentDocumentId ? () => navigate(buildAgentDocumentsPath(agentId)) : undefined;

  return (
    <PortalChromeHeader
      title={<DocumentTitle onOpenDocumentsIndex={openDocumentsIndex} />}
      rightExtra={
        <Flexbox horizontal align={'center'} gap={4}>
          {!isLoading && !metaLocked && <AutoSaveHint />}
          <OpenAsPageAction />
        </Flexbox>
      }
    />
  );
};

export default PortalHeader;
