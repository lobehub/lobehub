'use client';

import { Empty, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { MessageSquareTextIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import NavHeader from '@/features/NavHeader';
import RightPanel from '@/features/RightPanel';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';

import { usePageAgentPanelControl } from '../../RightPanel/OverrideContext';
import { usePageEditorStore } from '../../store';
import { useCommentAnchors } from '../anchor/context';
import Composer from '../Composer';
import { useDocumentComments } from '../context';
import { styles } from '../styles';
import Thread from '../Thread';
import type { DocumentCommentsState } from '../useDocumentCommentsState';
import { useForwardWheel } from './useForwardWheel';
import { PENDING_CARD_ID, useGutterLayout } from './useGutterLayout';

const PanelBody = memo<{ state: DocumentCommentsState }>(({ state }) => {
  const { t } = useTranslation('file');
  const {
    anchoredError,
    documentId,
    focus,
    gutterThreads,
    handleCreate,
    handlePinnedRootUpdate,
    handleReplyFocusMissing,
    handleUpdate,
    isAnchoredInitialError,
    isAnchoredLoading,
    isAnchoredRetrying,
    paneRef,
    pinnedThreadInGutter,
    refresh,
    refreshPinned,
    reloadAnchored,
    updatePinnedReplyCount,
    updateReplyCount,
    updateSummaryTotal,
  } = state;
  const { selectedRootId, selectRoot } = useCommentAnchors();
  const hasPending = usePageEditorStore((s) =>
    Boolean(s.pendingCommentAnchor && s.pendingCommentAnchor.documentId === documentId),
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const threads = pinnedThreadInGutter ? [pinnedThreadInGutter, ...gutterThreads] : gutterThreads;
  const ids = threads.map(({ root }) => root.id);
  // The composer is what the reader is working on, so it takes the line; a
  // picked card takes it otherwise.
  const activeId = hasPending ? PENDING_CARD_ID : selectedRootId;
  const { registerCard, scrollBy, tops } = useGutterLayout({
    activeId,
    hasPending,
    ids,
    paneRef,
    trackRef,
  });
  // The panel is not a scroll container; a wheel over it scrolls the document.
  useForwardWheel(hostRef, scrollBy);
  const isEmpty =
    threads.length === 0 && !hasPending && !isAnchoredLoading && !isAnchoredInitialError;

  const renderCard = (id: string, active: boolean, children: React.ReactNode) => {
    const top = tops.get(id);
    return (
      <div
        key={id}
        ref={registerCard(id)}
        style={{ top }}
        className={cx(
          styles.gutterCard,
          top !== undefined && styles.gutterCardPositioned,
          active && styles.gutterCardActive,
          id === PENDING_CARD_ID && styles.gutterCardComposer,
        )}
        onClick={id === PENDING_CARD_ID ? undefined : () => selectRoot(id)}
      >
        {children}
      </div>
    );
  };

  return (
    <div data-document-comment-gutter className={styles.gutter} ref={hostRef}>
      {isAnchoredInitialError ? (
        <AsyncError error={anchoredError} variant={'block'} onRetry={() => void reloadAnchored()} />
      ) : isAnchoredLoading ? (
        <SurfaceSkeleton header={false} variant={'list'} />
      ) : (
        isEmpty && (
          <Flexbox align={'center'} className={styles.gutterEmpty} justify={'center'}>
            <Empty
              description={t('pageEditor.comments.gutterEmpty')}
              icon={MessageSquareTextIcon}
            />
          </Flexbox>
        )
      )}
      {anchoredError && !isAnchoredInitialError && (
        <AsyncError
          error={anchoredError}
          retrying={isAnchoredRetrying}
          variant={'inline'}
          onRetry={() => void reloadAnchored()}
        />
      )}
      <div className={styles.gutterTrack} ref={trackRef}>
        {hasPending &&
          renderCard(
            PENDING_CARD_ID,
            true,
            <Composer
              anchorMode={'gutter'}
              documentId={documentId}
              focusReady={tops.has(PENDING_CARD_ID)}
              key={`anchored:${documentId}`}
              onSubmit={handleCreate}
            />,
          )}
        {pinnedThreadInGutter &&
          renderCard(
            pinnedThreadInGutter.root.id,
            selectedRootId === pinnedThreadInGutter.root.id,
            <Thread
              compact
              documentId={documentId}
              focus={focus}
              replyCount={pinnedThreadInGutter.replyCount}
              root={pinnedThreadInGutter.root}
              onFocusMissing={handleReplyFocusMissing}
              onMutated={refreshPinned}
              onReplyCountChange={updatePinnedReplyCount}
              onRootUpdate={handlePinnedRootUpdate}
              onSummaryChange={updateSummaryTotal}
            />,
          )}
        {gutterThreads.map(({ replyCount, root }) =>
          renderCard(
            root.id,
            selectedRootId === root.id,
            <Thread
              compact
              documentId={documentId}
              focus={focus?.rootCommentId === root.id ? focus : undefined}
              replyCount={replyCount}
              root={root}
              onFocusMissing={handleReplyFocusMissing}
              onMutated={refresh}
              onReplyCountChange={updateReplyCount}
              onRootUpdate={handleUpdate}
              onSummaryChange={updateSummaryTotal}
            />,
          ),
        )}
      </div>
    </div>
  );
});

PanelBody.displayName = 'DocumentCommentsPanelBody';

const DEFAULT_PANEL_WIDTH = 320;

const PanelContent = memo(() => {
  const { t } = useTranslation('file');
  const state = useDocumentComments();
  const setCommentsPanelOpen = usePageEditorStore((s) => s.setCommentsPanelOpen);

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0 }}>
      <NavHeader
        showTogglePanelButton={false}
        left={
          <Text
            ellipsis={{ tooltipWhenOverflow: true }}
            style={{ fontSize: 13, fontWeight: 500, marginLeft: 8 }}
            type={'secondary'}
          >
            {t('pageEditor.comments.title')}
            {state?.summary.data ? ` · ${state.summary.data.total}` : ''}
          </Text>
        }
        right={
          <ToggleRightPanelButton
            expand
            showActive={false}
            title={t('pageEditor.comments.toggle')}
            onToggle={() => setCommentsPanelOpen(false)}
          />
        }
      />
      {state ? (
        <PanelBody state={state} />
      ) : (
        <Flexbox align={'center'} className={styles.gutterEmpty} justify={'center'}>
          <Empty description={t('pageEditor.comments.gutterEmpty')} icon={MessageSquareTextIcon} />
        </Flexbox>
      )}
    </Flexbox>
  );
});

PanelContent.displayName = 'DocumentCommentsPanelContent';

/**
 * The sidebar for anchored comments: cards sit level with the text they
 * quote and ride along with the document's scroll, in a column of their own
 * so the page keeps its width. It is a panel in its own right, beside the
 * page-agent panel rather than a mode of it, so the copilot and the
 * comments never displace each other.
 */
const DocumentCommentsPanel = memo(() => {
  const [open, setOpen] = usePageEditorStore((s) => [s.commentsPanelOpen, s.setCommentsPanelOpen]);
  const [width, setWidth] = useState<number | string>(DEFAULT_PANEL_WIDTH);
  const { expand: agentOpen, toggle: toggleAgent } = usePageAgentPanelControl();

  // The two sidebars keep their own state but never show side by side: the
  // one that opens folds the other away. Only the transition into "open"
  // acts, so closing either never reopens the other.
  const wasOpenRef = useRef(open);
  const wasAgentOpenRef = useRef(agentOpen);
  useEffect(() => {
    const opened = open && !wasOpenRef.current;
    const agentOpened = agentOpen && !wasAgentOpenRef.current;
    wasOpenRef.current = open;
    wasAgentOpenRef.current = agentOpen;
    if (opened && agentOpen) toggleAgent(false);
    else if (agentOpened && open) setOpen(false);
  }, [agentOpen, open, setOpen, toggleAgent]);

  return (
    <RightPanel
      defaultWidth={width}
      expand={open}
      onExpandChange={setOpen}
      onSizeChange={(size) => {
        if (size?.width) setWidth(size.width);
      }}
    >
      <PanelContent />
    </RightPanel>
  );
});

DocumentCommentsPanel.displayName = 'DocumentCommentsPanel';

export default DocumentCommentsPanel;
