'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { useParams } from 'react-router';

import FloatingChatPanel from '@/features/FloatingChatPanel';
import { useDocumentChatTopic } from '@/features/FloatingChatPanel/useDocumentChatTopic';
import { PageEditor } from '@/features/PageEditor';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import Header from './Header';
import { buildAgentDocumentsPath } from './navigation';
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
  const {
    error: itemError,
    isNotFound,
    item,
    mutate,
    skillBundle,
  } = useAgentDocumentItem(agentId, documentId);

  // The route owns the agent — `useChatStore.activeAgentId` can be a different
  // agent (the user's main chat context). Pulling that one would 404 the
  // doc-anchored topic lookup whenever the active agent doesn't own this doc.
  const chatAgentId = agentId;
  // `item` is resolved out of *this agent's* document list, so its presence is the
  // ownership proof `getOrCreateChatTopic` demands. Waiting for it keeps a bad deep
  // link from firing a guaranteed-NOT_FOUND lookup before the redirect kicks in.
  const ownsDocument = !!item;
  const { topicId: docChatTopicId } = useDocumentChatTopic({
    agentId: ownsDocument ? chatAgentId : undefined,
    documentId: ownsDocument ? documentId : undefined,
  });

  const backToChat = useCallback(
    () => navigate(agentId ? `/agent/${agentId}` : '/agent'),
    [agentId, navigate],
  );

  // Deleting the open document lands on the docs index (empty-state guidance +
  // the persistent document tree) rather than the deleted doc's now-404 route.
  const backToDocs = useCallback(
    () => navigate(agentId ? buildAgentDocumentsPath(agentId) : '/agent'),
    [agentId, navigate],
  );

  // The doc backing this route can vanish while the page is open — most often
  // deleted from the working-sidebar tree (which optimistically drops the row
  // from the same list this reads). Redirect to the docs index rather than
  // stranding the user on a 404 for a doc they just removed. `isNotFound` is
  // precise (list resolved, doc genuinely absent — not a load error), so a bad
  // deep link also lands on the index instead of a dead end.
  useEffect(() => {
    if (isNotFound && agentId) navigate(buildAgentDocumentsPath(agentId), { replace: true });
  }, [isNotFound, agentId, navigate]);

  // A skill index doc is stored as `SKILL.md`; show the skill name (bundle title) instead.
  const isSkillIndex = !!skillBundle;
  const title = skillBundle
    ? skillBundle.title || skillBundle.filename || item?.title || item?.filename
    : item?.title || item?.filename;

  const header = useMemo(
    () => (
      <Header
        agentDocumentId={item?.id}
        agentId={agentId}
        documentId={documentId}
        itemError={itemError}
        title={title}
        updatedAt={item?.updatedAt}
        onBack={backToChat}
        onDeleted={backToDocs}
      />
    ),
    [agentId, backToChat, backToDocs, documentId, item?.id, item?.updatedAt, itemError, title],
  );

  // Genuinely-absent doc (deleted or bad deep link): render nothing while the
  // redirect effect above sends the user to the docs index, instead of flashing
  // a 404 for a doc that simply moved to the empty-state landing.
  if (isNotFound) return null;

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }} width={'100%'}>
      <Flexbox flex={1} style={{ minHeight: 0 }} width={'100%'}>
        <PageEditor
          fullWidthHeader
          header={header}
          key={documentId}
          // A skill index's visible name is the bundle title; renaming must go
          // through the skill APIs, so lock the page title/emoji here. A plain
          // title save would overwrite the `SKILL.md` filename and desync the
          // bundle (and the bundle rename API rejects managed skill docs anyway).
          metaReadOnly={isSkillIndex}
          pageId={documentId}
          rightPanel={false}
          syncPageAgentActiveState={false}
          title={title}
          // Refresh the list so the breadcrumb and working-sidebar entry pick up
          // the new title after the shared page save persists it.
          onTitleChange={() => mutate()}
        />
      </Flexbox>
      {chatAgentId && docChatTopicId && (
        <WideScreenContainer>
          <FloatingChatPanel
            agentDocumentId={item?.id}
            agentId={chatAgentId}
            documentId={documentId}
            key={`${chatAgentId}:${docChatTopicId}:${documentId}`}
            topicId={docChatTopicId}
          />
        </WideScreenContainer>
      )}
    </Flexbox>
  );
});

AgentDocumentPage.displayName = 'AgentDocumentPage';

export default AgentDocumentPage;
