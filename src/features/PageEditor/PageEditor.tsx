'use client';

import { DEFAULT_BLOCK_ANCHOR_PADDING, EditorProvider } from '@lobehub/editor/react';
import { cssVar, Flexbox } from '@lobehub/ui';
import type { FC, ReactNode, UIEvent } from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ComposerTarget } from '@/features/Conversation/types';
import DiffAllToolbar from '@/features/EditorCanvas/DiffAllToolbar';
import PageMetaBar from '@/features/PageEditor/PageMetaBar';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useRegisterFilesHotkeys } from '@/hooks/useHotkeys';
import { usePermission } from '@/hooks/usePermission';
import { pageActions } from '@/store/page';
import { StyleSheet } from '@/utils/styles';

import CharLimitBanner from './CharLimitBanner';
import { usePageCollabEligible, usePageCollabEnabled } from './collab/usePageCollab';
import DocumentComments from './DocumentComments';
import BlockCommentMarker from './DocumentComments/BlockCommentMarker';
import { DocumentCommentsProvider } from './DocumentComments/context';
import DocumentCommentsPanel from './DocumentComments/Gutter';
import { GUTTER_COLUMN_ATTRIBUTE } from './DocumentComments/Gutter/useGutterLayout';
import DocumentLikes from './DocumentLikes';
import EditorCanvas from './EditorCanvas';
import { recallEditorScrollTop, rememberEditorScrollTop } from './editorScrollMemory';
import Header from './Header';
import HtmlPageBody, { useIsHtmlPage } from './HtmlPageBody';
import LockedAlert from './LockedAlert';
import LockStatusBanner from './LockStatusBanner';
import { PageAgentProvider } from './PageAgentProvider';
import { PageEditorProvider } from './PageEditorProvider';
import RightPanel from './RightPanel';
import { usePageEditorStore } from './store';
import TableOfContents from './TableOfContents';
import TitleSection from './TitleSection';
import { usePageEditable } from './usePageEditable';

/**
 * Header slot for PageEditor.
 * - `undefined` (default): render the built-in `<Header />`
 * - `null`: render no header
 * - any other ReactNode: render the provided node in place of the built-in header
 *
 * Custom headers are rendered inside the PageEditor provider tree, so they can
 * call hooks like `usePageEditorStore` and reuse internal pieces such as `useMenu`.
 */
type PageEditorHeader = ReactNode | null;

const getMaxScrollTop = (node: HTMLElement) => Math.max(node.scrollHeight - node.clientHeight, 0);

const shouldRestoreEditorScroll = ({
  isUserInteractingWithEditor,
  maxScrollTop,
  nextScrollTop,
  previousScrollTop,
}: {
  isUserInteractingWithEditor: boolean;
  maxScrollTop: number;
  nextScrollTop: number;
  previousScrollTop: number;
}) =>
  previousScrollTop > 0 &&
  nextScrollTop === 0 &&
  maxScrollTop >= previousScrollTop &&
  !isUserInteractingWithEditor;

const styles = StyleSheet.create({
  artifactContent: {
    minWidth: 0,
    paddingBlock: 24,
    paddingInline: 24,
  },
  contentWrapper: {
    containerType: 'inline-size',
    display: 'flex',
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    position: 'relative',
  },
  editorContainer: {
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  editorContent: {
    paddingInline: DEFAULT_BLOCK_ANCHOR_PADDING,
    position: 'relative',
  },
});

interface PageEditorProps {
  /** Composer that receives selections created by the Ask Copilot toolbar item. */
  askCopilotTarget?: ComposerTarget;
  emoji?: string;
  /**
   * When true, the header spans the full editor width above the body and the
   * right panel only fills the body area. Defaults to false (header sits in
   * the left column only, right panel runs floor-to-ceiling).
   */
  fullWidthHeader?: boolean;
  header?: PageEditorHeader;
  knowledgeBaseId?: string;
  /**
   * Make the page title/emoji read-only while keeping the body editable. Set for
   * managed docs whose identity lives elsewhere (e.g. a skill's `SKILL.md`
   * index — see {@link PublicState.metaReadOnly}).
   */
  metaReadOnly?: boolean;
  onBack?: () => void;
  onDelete?: () => void;
  onDocumentIdChange?: (newId: string) => void;
  onEmojiChange?: (emoji: string | undefined) => void;
  onSave?: () => void;
  onTitleChange?: (title: string) => void;
  pageId?: string;
  /**
   * Render the built-in right panel (page copilot / history). Defaults to true.
   * Set false when an outer layout supplies its own right panel (e.g. the
   * agent-document route keeps the agent working sidebar instead).
   */
  rightPanel?: boolean;
  /**
   * Whether PageEditor should sync its page-copilot agent into the global
   * agent/chat stores. Defaults to true for normal Pages. Set false when the
   * editor is embedded under an existing agent layout that must preserve its
   * own active agent and topic state.
   */
  syncPageAgentActiveState?: boolean;
  title?: string;
}

interface PageEditorCanvasProps {
  askCopilotTarget?: ComposerTarget;
  fullWidthHeader?: boolean;
  header?: PageEditorHeader;
  rightPanel?: boolean;
}

const PageEditorCanvas = memo<PageEditorCanvasProps>((props) => {
  const { askCopilotTarget, header, fullWidthHeader, rightPanel } = props;
  const showRightPanel = rightPanel !== false;
  const editable = usePageEditable();
  const editor = usePageEditorStore((s) => s.editor);
  const documentId = usePageEditorStore((s) => s.documentId);
  const isHtmlPage = useIsHtmlPage(documentId);
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const restoreScrollFrameRef = useRef<number | undefined>(undefined);
  const isRestoringScrollRef = useRef(false);
  const isPointerInsideEditorPaneRef = useRef(false);
  const lastEditorScrollTopRef = useRef(0);
  // Set while a freshly switched-in document is still loading its content and
  // has a remembered offset to return to. Cleared once we land there or the
  // user scrolls on their own.
  const pendingDocumentRestoreRef = useRef(false);
  const activeDocumentIdRef = useRef<string | undefined>(undefined);
  const editorPaneRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const editorContentRef = useRef<HTMLDivElement>(null);

  const isUserInteractingWithEditor = useCallback(() => {
    if (isPointerInsideEditorPaneRef.current) return true;

    const activeElement = document.activeElement;
    return !!activeElement && !!editorPaneRef.current?.contains(activeElement);
  }, []);

  const restoreEditorScrollPosition = useCallback(() => {
    const node = contentWrapperRef.current;
    if (!node || typeof window === 'undefined') return;

    const maxScrollTop = getMaxScrollTop(node);
    const targetScrollTop = Math.min(lastEditorScrollTopRef.current, maxScrollTop);

    if (targetScrollTop <= 0 || node.scrollTop === targetScrollTop) return;

    // The remembered offset is only reachable once the document's content has
    // grown tall enough; keep waiting for the next layout change otherwise.
    if (targetScrollTop === lastEditorScrollTopRef.current) {
      pendingDocumentRestoreRef.current = false;
    }

    isRestoringScrollRef.current = true;
    node.scrollTop = targetScrollTop;

    window.requestAnimationFrame(() => {
      isRestoringScrollRef.current = false;
    });
  }, []);

  const scheduleRestoreEditorScrollPosition = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (restoreScrollFrameRef.current) {
      window.cancelAnimationFrame(restoreScrollFrameRef.current);
    }

    restoreScrollFrameRef.current = window.requestAnimationFrame(() => {
      restoreScrollFrameRef.current = undefined;
      restoreEditorScrollPosition();
    });
  }, [restoreEditorScrollPosition]);

  const handleEditorScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (isRestoringScrollRef.current) return;

      const node = event.currentTarget;
      const nextScrollTop = node.scrollTop;
      const previousScrollTop = lastEditorScrollTopRef.current;

      // While a switched-in document is still loading, the browser clamps the
      // offset as content streams in. Those events are layout noise, not the
      // user scrolling — keep aiming for the remembered offset.
      if (pendingDocumentRestoreRef.current) {
        if (nextScrollTop < previousScrollTop && !isUserInteractingWithEditor()) {
          scheduleRestoreEditorScrollPosition();
          return;
        }
        pendingDocumentRestoreRef.current = false;
      }

      if (
        shouldRestoreEditorScroll({
          isUserInteractingWithEditor: isUserInteractingWithEditor(),
          maxScrollTop: getMaxScrollTop(node),
          nextScrollTop,
          previousScrollTop,
        })
      ) {
        scheduleRestoreEditorScrollPosition();
        return;
      }

      lastEditorScrollTopRef.current = nextScrollTop;
      rememberEditorScrollTop(activeDocumentIdRef.current, nextScrollTop);
    },
    [isUserInteractingWithEditor, scheduleRestoreEditorScrollPosition],
  );

  // Every document keeps its own scroll offset. Switching documents in place
  // (ResourceManager renders PageEditor without a key) must not carry the
  // previous document's offset over: a never-opened document starts at the
  // top, a revisited one returns to where the reader left off once its
  // content has loaded.
  useLayoutEffect(() => {
    if (activeDocumentIdRef.current === documentId) return;

    activeDocumentIdRef.current = documentId;

    const rememberedScrollTop = recallEditorScrollTop(documentId);
    lastEditorScrollTopRef.current = rememberedScrollTop;
    pendingDocumentRestoreRef.current = rememberedScrollTop > 0;

    const node = contentWrapperRef.current;
    if (!node) return;

    if (node.scrollTop !== 0) {
      isRestoringScrollRef.current = true;
      node.scrollTop = 0;
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          isRestoringScrollRef.current = false;
        });
      } else {
        isRestoringScrollRef.current = false;
      }
    }

    if (pendingDocumentRestoreRef.current) scheduleRestoreEditorScrollPosition();
  }, [documentId, scheduleRestoreEditorScrollPosition]);

  // Document content arrives asynchronously (SWR); the pane itself doesn't
  // resize when the content grows, so watch the content box to know when the
  // remembered offset becomes reachable.
  useEffect(() => {
    const node = editorContentRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (pendingDocumentRestoreRef.current) scheduleRestoreEditorScrollPosition();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [scheduleRestoreEditorScrollPosition]);

  const notifyEditorLayoutChange = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (resizeFrameRef.current) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = undefined;
      window.dispatchEvent(new Event('resize'));
      scheduleRestoreEditorScrollPosition();
    });
  }, [scheduleRestoreEditorScrollPosition]);

  useEffect(() => {
    const node = editorPaneRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => notifyEditorLayoutChange());
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [notifyEditorLayoutChange]);

  useEffect(
    () => () => {
      if (resizeFrameRef.current && typeof window !== 'undefined') {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      if (restoreScrollFrameRef.current && typeof window !== 'undefined') {
        window.cancelAnimationFrame(restoreScrollFrameRef.current);
      }
    },
    [],
  );

  // Register Files scope and save document hotkey
  useRegisterFilesHotkeys();

  const headerSlot = header === undefined ? <Header /> : header;

  const editorPane = (
    <Flexbox
      flex={1}
      height={'100%'}
      ref={editorPaneRef}
      style={styles.editorContainer}
      onPointerEnter={() => {
        isPointerInsideEditorPaneRef.current = true;
      }}
      onPointerLeave={() => {
        isPointerInsideEditorPaneRef.current = false;
      }}
    >
      {!fullWidthHeader && headerSlot}
      <Flexbox
        horizontal
        height={'100%'}
        ref={contentWrapperRef}
        style={styles.contentWrapper}
        width={'100%'}
        onScroll={handleEditorScroll}
      >
        {isHtmlPage ? (
          // An artifact is a finished, self-styled page: it gets the pane's full
          // width instead of the reading column, and no editable title above it
          // (the header carries the title; the HTML has its own heading).
          <Flexbox flex={1} gap={24} ref={editorContentRef} style={styles.artifactContent}>
            <HtmlPageBody />
            <WideScreenContainer>
              {documentId && <DocumentLikes documentId={documentId} key={documentId} />}
              <DocumentComments />
            </WideScreenContainer>
          </Flexbox>
        ) : (
          <WideScreenContainer
            wrapperStyle={{ cursor: editable ? 'text' : 'default' }}
            onChange={notifyEditorLayoutChange}
            onClick={() => {
              if (!editable) return;

              editor?.focus();
            }}
          >
            <Flexbox
              flex={1}
              ref={editorContentRef}
              style={styles.editorContent}
              {...{ [GUTTER_COLUMN_ATTRIBUTE]: true }}
            >
              <TitleSection />
              <PageMetaBar />
              {/* Surfaces local heartbeat health (unstable/lost) for the holder.
                  Suppressed when LockedAlert is showing — see LockStatusBanner. */}
              <LockStatusBanner />
              {/* Prominent in-body notice when another member holds the lock; the
                  compact status badge lives in the Header (EditingIndicator). */}
              <LockedAlert />
              {/* Plan page-size limit: refused-save notice and near-limit warning. */}
              <CharLimitBanner />
              <EditorCanvas askCopilotTarget={askCopilotTarget} />
              <BlockCommentMarker hostRef={editorContentRef} />
              {documentId && <DocumentLikes documentId={documentId} key={documentId} />}
              <DocumentComments />
            </Flexbox>
          </WideScreenContainer>
        )}
      </Flexbox>
      {!isHtmlPage && (
        <TableOfContents contentRef={editorContentRef} scrollRef={contentWrapperRef} />
      )}
      {documentId && <DiffAllToolbar documentId={documentId} editor={editor} />}
    </Flexbox>
  );

  // Comment state is hosted above every surface that reads it: the header's
  // toggle, the list below the body and the panel beside it share one set of
  // caches, and the panel's cards follow the body pane's scroll.
  const withComments = (node: ReactNode) => (
    <DocumentCommentsProvider
      documentId={documentId}
      paneRef={contentWrapperRef}
      panelAvailable={showRightPanel}
    >
      {node}
    </DocumentCommentsProvider>
  );

  if (fullWidthHeader) {
    return withComments(
      <Flexbox height={'100%'} style={{ backgroundColor: cssVar.colorBgContainer }} width={'100%'}>
        {headerSlot}
        <Flexbox horizontal flex={1} style={{ minHeight: 0 }} width={'100%'}>
          {editorPane}
          {showRightPanel && <DocumentCommentsPanel />}
          {showRightPanel && <RightPanel />}
        </Flexbox>
      </Flexbox>,
    );
  }

  return withComments(
    <Flexbox
      horizontal
      height={'100%'}
      style={{ backgroundColor: cssVar.colorBgContainer }}
      width={'100%'}
    >
      {editorPane}
      {showRightPanel && <DocumentCommentsPanel />}
      {showRightPanel && <RightPanel />}
    </Flexbox>,
  );
});

/**
 * Edit a page
 *
 * A reusable component. Should NOT depend on context.
 */
export const PageEditor: FC<PageEditorProps> = ({
  askCopilotTarget,
  pageId,
  header,
  fullWidthHeader,
  knowledgeBaseId,
  metaReadOnly,
  onDocumentIdChange,
  onEmojiChange,
  onSave,
  onTitleChange,
  onBack,
  title,
  emoji,
  rightPanel,
  syncPageAgentActiveState,
}) => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const collabEnabled = usePageCollabEnabled();
  // Known once the document loads; a SKILL.md then leaves the room path.
  const collabEligible = usePageCollabEligible(pageId);
  const [collabEpoch, setCollabEpoch] = useState(0);
  const handleCollabReset = useCallback(() => setCollabEpoch((epoch) => epoch + 1), []);

  return (
    <PageAgentProvider pageId={pageId} syncActiveAgent={syncPageAgentActiveState}>
      {/* A collaboration binding lives for the editor kernel's lifetime, so each room gets a
          fresh kernel, and a document that leaves the room path drops the binding. */}
      <EditorProvider
        key={collabEnabled ? `${pageId}:${collabEligible ? collabEpoch : 'stored'}` : undefined}
      >
        <PageEditorProvider
          emoji={emoji}
          knowledgeBaseId={knowledgeBaseId}
          metaReadOnly={metaReadOnly}
          pageId={pageId}
          title={title}
          onBack={onBack}
          onCollabReset={collabEnabled ? handleCollabReset : undefined}
          onDocumentIdChange={onDocumentIdChange}
          onDelete={() => {
            if (!canEdit) return;

            pageActions.deletePage(pageId || '');
          }}
          onEmojiChange={(emoji) => {
            if (!canEdit) return;

            onEmojiChange?.(emoji);
          }}
          onSave={() => {
            if (!canEdit) return;

            onSave?.();
          }}
          onTitleChange={(nextTitle) => {
            if (!canEdit) return;

            onTitleChange?.(nextTitle);
          }}
        >
          <PageEditorCanvas
            askCopilotTarget={askCopilotTarget}
            fullWidthHeader={fullWidthHeader}
            header={header}
            rightPanel={rightPanel}
          />
        </PageEditorProvider>
      </EditorProvider>
    </PageAgentProvider>
  );
};
