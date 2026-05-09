'use client';

import { Flexbox } from '@lobehub/ui';
import { debounce } from 'es-toolkit/compat';
import { memo, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { AutoSaveHint } from '@/features/EditorCanvas';
import FloatingChatPanel from '@/features/FloatingChatPanel';
import TopicCanvas from '@/features/TopicCanvas';
import { useAutoCreateTopicDocument } from '@/features/TopicCanvas/useAutoCreateTopicDocument';
import { useClientDataSWR } from '@/libs/swr';
import HeaderSlot from '@/routes/(main)/agent/(chat)/_layout/HeaderSlot';
import { documentService } from '@/services/document';
import { invalidateDocumentMutation } from '@/services/document/invalidation';
import { documentSWRKeys } from '@/services/document/swrKeys';

const MAX_PANEL_WIDTH = 1024;
const TITLE_SAVE_DEBOUNCE = 500;

const TopicPage = memo(() => {
  const { aid, topicId, docId } = useParams<{ aid?: string; docId?: string; topicId?: string }>();
  const navigate = useNavigate();

  const { documentId: topicDocumentId } = useAutoCreateTopicDocument(topicId, aid);

  const [titleDraft, setTitleDraft] = useState<string | undefined>();

  const {
    data: documentMeta,
    error: documentError,
    isLoading: isDocLoading,
  } = useClientDataSWR(docId ? documentSWRKeys.pageMeta(docId) : null, () =>
    documentService.getDocumentById(docId!),
  );

  const isInvalidDoc = Boolean(docId && !isDocLoading && (documentError || documentMeta == null));

  useEffect(() => {
    if (!aid || !topicId) return;
    if (!isInvalidDoc) return;
    if (!topicDocumentId) return;
    if (topicDocumentId === docId) return;
    navigate(`/agent/${aid}/${topicId}/page/${topicDocumentId}`, { replace: true });
  }, [aid, topicId, docId, isInvalidDoc, topicDocumentId, navigate]);

  useEffect(() => {
    setTitleDraft(undefined);
  }, [docId]);

  const debouncedSaveTitle = useMemo(
    () =>
      debounce(
        async (
          id: string,
          nextTitle: string,
          ctx: { agentId: string | undefined; topicId: string | undefined },
        ) => {
          await documentService.updateDocument({
            id,
            saveSource: 'autosave',
            title: nextTitle,
          });
          await invalidateDocumentMutation({
            agentId: ctx.agentId,
            cause: 'page-title',
            documentId: id,
            refreshDocumentEditor: false,
            topicId: ctx.topicId,
          });
        },
        TITLE_SAVE_DEBOUNCE,
      ),
    [],
  );

  const handleTitleChange = (next: string) => {
    setTitleDraft(next);
    if (docId) debouncedSaveTitle(docId, next, { agentId: aid, topicId });
  };

  if (!aid || !topicId) return null;

  const displayTitle = titleDraft ?? documentMeta?.title ?? '';

  return (
    <Flexbox
      align={'center'}
      data-testid="agent-page-container"
      height={'100%'}
      style={{ minHeight: 0, minWidth: 0, position: 'relative' }}
      width={'100%'}
    >
      {docId && (
        <HeaderSlot>
          <AutoSaveHint documentId={docId} />
        </HeaderSlot>
      )}
      <Flexbox
        align={'center'}
        flex={1}
        style={{ minHeight: 0, overflowX: 'hidden', overflowY: 'auto' }}
        width={'100%'}
      >
        <Flexbox style={{ maxWidth: MAX_PANEL_WIDTH, paddingBlockEnd: 16 }} width={'100%'}>
          <TopicCanvas
            agentId={aid}
            documentId={docId}
            title={displayTitle}
            topicId={topicId}
            onTitleChange={handleTitleChange}
          />
        </Flexbox>
      </Flexbox>
      <Flexbox style={{ maxWidth: MAX_PANEL_WIDTH, zIndex: 19 }} width={'100%'}>
        <FloatingChatPanel
          agentId={aid}
          documentId={docId}
          maxHeight={0.92}
          minHeight={320}
          scope={'page'}
          topicId={topicId}
          variant={'embedded'}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default TopicPage;
