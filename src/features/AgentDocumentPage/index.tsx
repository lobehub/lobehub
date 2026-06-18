'use client';

import { memo, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { PageEditor } from '@/features/PageEditor';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import Header from './Header';
import { useAgentDocumentItem } from './useAgentDocumentItem';

interface AgentDocumentPageProps {
  /** Full `documents` table id, e.g. `docs_MWkYMvbvzssoyWZ9`. */
  documentId: string;
}

/**
 * Standalone document view at `/agent/:aid/docs/:docId`. Reuses the shared
 * `PageEditor` (big title, Ask AI / slash items, width control, autosave) — an
 * agent document is a row in the same `documents` table as a page — but swaps in
 * an agent breadcrumb header and drops the page copilot panel so the outer
 * document layout owns the page-mode right panel.
 */
const AgentDocumentPage = memo<AgentDocumentPageProps>(({ documentId }) => {
  const { aid } = useParams<{ aid: string }>();
  const agentId = aid ?? '';
  const navigate = useWorkspaceAwareNavigate();
  const { item, mutate } = useAgentDocumentItem(agentId, documentId);

  const backToChat = useCallback(
    () => navigate(agentId ? `/agent/${agentId}` : '/agent'),
    [agentId, navigate],
  );

  const title = item?.title || item?.filename;

  const header = useMemo(
    () => (
      <Header
        agentDocumentId={item?.id}
        agentId={agentId}
        documentId={documentId}
        title={title}
        updatedAt={item?.updatedAt}
        onBack={backToChat}
        onDeleted={backToChat}
      />
    ),
    [agentId, backToChat, documentId, item?.id, item?.updatedAt, title],
  );

  return (
    <PageEditor
      fullWidthHeader
      header={header}
      key={documentId}
      pageId={documentId}
      rightPanel={false}
      syncPageAgentActiveState={false}
      title={title}
      // Persisted via the shared document save; refresh the list so the
      // breadcrumb and working-sidebar entry pick up the new title.
      onTitleChange={() => mutate()}
    />
  );
});

AgentDocumentPage.displayName = 'AgentDocumentPage';

export default AgentDocumentPage;
