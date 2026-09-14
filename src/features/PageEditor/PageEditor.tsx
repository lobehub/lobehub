'use client';

import {
  type AnnotationClickContext,
  type AnnotationComposerContext,
  type CapturedCollaborativeRewriteSelection,
  ICollaborativeTargetLeaseService,
  IYjsService,
  type YjsAwarenessUser,
} from '@lobehub/editor';
import { DEFAULT_BLOCK_ANCHOR_PADDING, EditorProvider } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { CSSProperties, FC, ReactNode, UIEvent } from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { CONVERSATION_MIN_WIDTH } from '@/const/layoutTokens';
import type { ComposerTarget } from '@/features/Conversation/types';
import DiffAllToolbar from '@/features/EditorCanvas/DiffAllToolbar';
import PageMetaBar from '@/features/PageEditor/PageMetaBar';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useRegisterFilesHotkeys } from '@/hooks/useHotkeys';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { usePageStore } from '@/store/page';
import { StyleSheet } from '@/utils/styles';

import { PageAnnotationComposerProvider } from './annotationComposerContext';
import {
  PageAnnotationNavigationProvider,
  type PageAnnotationNavigationRequest,
} from './annotationNavigationContext';
import { PageAnnotationStorageProvider } from './Copilot/annotationStorage';
import { isPageRewriteActiveStatus, usePageRewriteRequests } from './Copilot/rewriteRequests';
import DocumentComments from './DocumentComments';
import DocumentLikes from './DocumentLikes';
import EditorCanvas from './EditorCanvas';
import { clearPageAIProvenanceFocus } from './EditorCanvas/aiProvenance';
import { PAGE_EDITOR_SCROLL_ANCHORING_ATTRIBUTE } from './EditorCanvas/collaborationScrollAnchoring';
import PageRewriteBlockMenuPlugin from './EditorCanvas/PageRewriteBlockMenuPlugin';
import RewriteSelectionHighlightPlugin from './EditorCanvas/RewriteSelectionHighlightPlugin';
import { createPageRewriteTargetLeases } from './EditorCanvas/targetLeaseProjection';
import Header from './Header';
import LockedAlert from './LockedAlert';
import LockStatusBanner from './LockStatusBanner';
import { PageAgentProvider } from './PageAgentProvider';
import { PageEditorProvider, usePageEditorEditorLifecycle } from './PageEditorProvider';
import { switchToPageRewriteDraft } from './pageRewriteDraft';
import PageTableOfContents from './PageTableOfContents';
import {
  PageRewriteComposerProvider,
  type PageRewriteContinuationTarget,
} from './rewriteComposerContext';
import RightPanel from './RightPanel';
import { usePageAgentPanelControl } from './RightPanel/OverrideContext';
import { usePageEditorStore } from './store';
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

const WIDE_SCREEN_CONTAINER_PADDING = 16;
const TABLE_BASE_BLEED = DEFAULT_BLOCK_ANCHOR_PADDING + WIDE_SCREEN_CONTAINER_PADDING;

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
  bodyWrapper: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  contentWrapper: {
    alignItems: 'start',
    containerType: 'size',
    display: 'grid',
    flex: 1,
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    minHeight: 0,
    minWidth: 0,
    overflowY: 'auto',
    position: 'relative',
  },
  documentColumn: {
    containerType: 'inline-size',
    minWidth: 0,
    width: '100%',
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

const overrideStyles = createStaticStyles(({ css }) => ({
  editorContent: css`
    .lobe-editor-table-scroll-wrapper.lobe-editor-table-scroll-wrapper:not(
        [data-hole-table-viewport]
      ) {
      --lobe-block-anchor-padding: var(--lobe-pageeditor-table-bleed-inline);

      position: relative;
      box-sizing: border-box;
      width: 100cqi;
      margin-inline: calc(var(--lobe-pageeditor-table-bleed-inline) * -1);
    }

    .lobe-editor-table-scroll-wrapper:not([data-hole-table-viewport]) .editor_table {
      width: max-content;
    }
  `,
  editorRoot: css`
    /* stylelint-disable selector-pseudo-element-no-unknown */
    &::highlight(ai-session-active) {
      background-color: ${cssVar.colorWarningBg};
    }

    &::highlight(ai-session-hover) {
      background-color: ${cssVar.colorInfoBg};
    }
    /* stylelint-enable selector-pseudo-element-no-unknown */

    &[data-ai-session-highlight-overlay='true']
      .ai-session-highlight-overlay[data-ai-session-highlight-kind='active'],
    &
      [data-ai-session-highlight-overlay='true']
      .ai-session-highlight-overlay[data-ai-session-highlight-kind='active'] {
      background-color: ${cssVar.colorWarningBg};
    }

    &[data-ai-session-highlight-overlay='true']
      .ai-session-highlight-overlay[data-ai-session-highlight-kind='hover'],
    &
      [data-ai-session-highlight-overlay='true']
      .ai-session-highlight-overlay[data-ai-session-highlight-kind='hover'] {
      background-color: ${cssVar.colorInfoBg};
    }

    &.ai-session-active,
    & .ai-session-active {
      background-color: ${cssVar.colorWarningBg};
      box-decoration-break: slice;
    }

    &.ai-session-hover,
    & .ai-session-hover {
      background-color: ${cssVar.colorInfoBg};
      box-decoration-break: slice;
    }

    /* Atomic cards use one host-bound overlay, not text ranges or a label
       inserted into document flow. Existing lease guards still own access. */
    &
      :is([data-hole='true'], [data-lexical-decorator='true']):is(
        [data-collaborative-target-locked='true'],
        [data-page-rewrite-block-selected='true']
      ) {
      position: relative;
    }

    &
      :is([data-hole='true'], [data-lexical-decorator='true']):is(
        [data-collaborative-target-locked='true'],
        [data-page-rewrite-block-selected='true']
      )::after {
      pointer-events: none;
      content: '';

      position: absolute;
      z-index: 5;
      inset: 0;

      border: 1px solid color-mix(in srgb, ${cssVar.purple} 45%, transparent);
      border-radius: inherit;

      background: color-mix(in srgb, ${cssVar.purple} 16%, transparent);
    }
  `,
}));

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
  syncPageAgentActiveState?: boolean;
}

const PageEditorCanvas = memo<PageEditorCanvasProps>((props) => {
  const {
    askCopilotTarget,
    header,
    fullWidthHeader,
    rightPanel,
    syncPageAgentActiveState = true,
  } = props;
  const showRightPanel = rightPanel !== false;
  const editable = usePageEditable();
  const storeEditor = usePageEditorStore((s) => s.editor);
  const pageEditorEditorLifecycle = usePageEditorEditorLifecycle();
  const editor = pageEditorEditorLifecycle?.editor ?? storeEditor;
  const documentId = usePageEditorStore((s) => s.documentId);
  const { requests: rewriteRequests } = usePageRewriteRequests(documentId);
  const activeRewriteRequests = useMemo(
    () => rewriteRequests.filter((request) => isPageRewriteActiveStatus(request.status)),
    [rewriteRequests],
  );
  const activeRewriteNodeIds = useMemo(
    () =>
      Array.from(
        new Set(
          activeRewriteRequests.flatMap((request) => {
            const selection = request.selection as {
              targetKind?: unknown;
              targetNodeIds?: unknown;
            };
            if (selection?.targetKind !== 'node' || !Array.isArray(selection.targetNodeIds)) {
              return [];
            }
            return selection.targetNodeIds.filter(
              (nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0,
            );
          }),
        ),
      ),
    [activeRewriteRequests],
  );
  const setRightPanelMode = usePageEditorStore((s) => s.setRightPanelMode);
  const setRightPanelTab = usePageEditorStore((s) => s.setRightPanelTab);
  const switchTopic = useChatStore((s) => s.switchTopic);
  const { toggle: togglePageAgentPanel } = usePageAgentPanelControl();
  const togglePageAgentPanelRef = useRef(togglePageAgentPanel);
  togglePageAgentPanelRef.current = togglePageAgentPanel;
  const [annotationComposer, setAnnotationComposer] = useState<AnnotationComposerContext | null>(
    null,
  );
  const [annotationNavigationRequest, setAnnotationNavigationRequest] =
    useState<PageAnnotationNavigationRequest | null>(null);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
  const [rewriteSelection, setRewriteSelection] =
    useState<CapturedCollaborativeRewriteSelection | null>(null);
  const [continuationTarget, setContinuationTarget] =
    useState<PageRewriteContinuationTarget | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [draftHighlightVisible, setDraftHighlightVisible] = useState(false);
  const annotationRequestTokenRef = useRef(0);
  const requestAnnotation = useCallback((annotationId: string) => {
    if (!annotationId) return;
    annotationRequestTokenRef.current += 1;
    setAnnotationNavigationRequest({
      annotationId,
      token: annotationRequestTokenRef.current,
    });
  }, []);
  const selectAnnotationIds = useCallback((ids: readonly string[]) => {
    const next = [
      ...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)),
    ];
    setSelectedAnnotationIds(next);
  }, []);
  useLayoutEffect(() => {
    setSelectedAnnotationIds([]);
    setRewriteSelection(null);
    setContinuationTarget(null);
    setDraftHighlightVisible(false);
  }, [documentId]);

  useEffect(() => {
    if (!editor) return;

    let disposed = false;
    let unsubscribeAwareness: (() => void) | undefined;
    let boundLeaseService: ICollaborativeTargetLeaseService | null = null;

    const replaceLeases = (awarenessUsers: readonly YjsAwarenessUser[] = []): void => {
      if (disposed) return;
      const leaseService = editor.requireService(ICollaborativeTargetLeaseService);
      if (!leaseService) return;
      boundLeaseService = leaseService;
      leaseService.replaceLeases(
        createPageRewriteTargetLeases({
          awarenessUsers,
          documentId,
          requests: rewriteRequests,
        }),
      );
    };

    const tryBind = (): void => {
      if (disposed) return;
      const leaseService = editor.requireService(ICollaborativeTargetLeaseService);
      if (!leaseService) return;
      boundLeaseService = leaseService;
      const yjsService = editor.requireService(IYjsService);
      if (yjsService && !unsubscribeAwareness) {
        unsubscribeAwareness = yjsService.subscribeAwarenessUsers((users) => {
          replaceLeases(users);
        });
      }
      replaceLeases(yjsService?.getAwarenessUsers() ?? []);
    };

    const onInitialized = (): void => {
      tryBind();
    };

    editor.on('initialized', onInitialized);
    tryBind();

    return () => {
      disposed = true;
      editor.off('initialized', onInitialized);
      unsubscribeAwareness?.();
      boundLeaseService?.replaceLeases([]);
    };
  }, [documentId, editor, rewriteRequests]);
  const handleAnnotationClick = useCallback(
    (context: AnnotationClickContext) => {
      const { ids } = context;
      const groupIds = (context as AnnotationClickContext & { groupIds?: readonly string[] })
        .groupIds;
      const annotationId = ids[0];
      if (!annotationId) return;
      selectAnnotationIds(groupIds?.length ? groupIds : ids);
      requestAnnotation(annotationId);
      setRightPanelMode('copilot');
      setRightPanelTab('annotations');
      togglePageAgentPanelRef.current(true);
    },
    [requestAnnotation, selectAnnotationIds, setRightPanelMode, setRightPanelTab],
  );
  const handleComposerChange = useCallback(
    (next: AnnotationComposerContext | null) => {
      setAnnotationComposer(next);
      if (next) {
        setRightPanelMode('copilot');
        setRightPanelTab('annotations');
        togglePageAgentPanelRef.current(true);
      }
    },
    [setRightPanelMode, setRightPanelTab],
  );
  const handleRewriteSelection = useCallback(
    (selection: CapturedCollaborativeRewriteSelection) => {
      // A fresh editor selection supersedes any open continuation session. The
      // right panel derives its visible mode from this selection, while
      // clearing the explicit target here lets the canvas drop the old
      // highlight in the same React update.
      clearPageAIProvenanceFocus(editor);
      setContinuationTarget(null);
      // A fresh rewrite is a new page-scoped draft. Drop the visible topic
      // pointer, but leave its persisted history and any in-flight generation
      // untouched so the user can return to it later.
      if (syncPageAgentActiveState) switchToPageRewriteDraft(switchTopic);
      setSelectionVersion((version) => version + 1);
      setRewriteSelection(selection);
      setDraftHighlightVisible(true);
      setRightPanelMode('copilot');
      setRightPanelTab('agent-edits');
      togglePageAgentPanelRef.current(true);
    },
    [
      editor,
      setRightPanelMode,
      setRightPanelTab,
      setContinuationTarget,
      switchTopic,
      syncPageAgentActiveState,
    ],
  );
  const closeRewriteComposer = useCallback(() => {
    setRewriteSelection(null);
    setContinuationTarget(null);
    setDraftHighlightVisible(false);
  }, []);
  const rewriteComposerValue = useMemo(
    () => ({
      close: closeRewriteComposer,
      draftHighlightVisible,
      setDraftHighlightVisible,
      continuationTarget,
      selectionVersion,
      selection: rewriteSelection,
      setContinuationTarget,
    }),
    [
      closeRewriteComposer,
      continuationTarget,
      draftHighlightVisible,
      rewriteSelection,
      selectionVersion,
    ],
  );
  const wideScreen = useGlobalStore(systemStatusSelectors.wideScreen);
  const tableBleedInline = wideScreen
    ? `${TABLE_BASE_BLEED}px`
    : `calc(${TABLE_BASE_BLEED}px + max((100cqi - ${CONVERSATION_MIN_WIDTH}px) / 2, 0px))`;
  const editorContentStyle = {
    ...styles.editorContent,
    '--lobe-pageeditor-table-bleed-inline': tableBleedInline,
  } as CSSProperties;
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const restoreScrollFrameRef = useRef<number | undefined>(undefined);
  const isRestoringScrollRef = useRef(false);
  const isPointerInsideEditorPaneRef = useRef(false);
  const lastEditorScrollTopRef = useRef(0);
  const editorPaneRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);

  // The canvas stays mounted while the route swaps between pages. Reset both
  // the DOM scroll position and the layout-restoration snapshot here so a
  // long page cannot donate its bottom position to the next document.
  useLayoutEffect(() => {
    const node = contentWrapperRef.current;
    lastEditorScrollTopRef.current = 0;

    if (!node || typeof window === 'undefined') return;

    if (restoreScrollFrameRef.current) {
      window.cancelAnimationFrame(restoreScrollFrameRef.current);
      restoreScrollFrameRef.current = undefined;
    }

    isRestoringScrollRef.current = true;
    node.scrollTop = 0;

    const frame = window.requestAnimationFrame(() => {
      isRestoringScrollRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [documentId]);

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
      const node = event.currentTarget;
      if (node.hasAttribute(PAGE_EDITOR_SCROLL_ANCHORING_ATTRIBUTE)) {
        lastEditorScrollTopRef.current = node.scrollTop;
        return;
      }
      if (isRestoringScrollRef.current) return;

      const nextScrollTop = node.scrollTop;
      const previousScrollTop = lastEditorScrollTopRef.current;

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
    },
    [isUserInteractingWithEditor, scheduleRestoreEditorScrollPosition],
  );

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
      <Flexbox horizontal style={styles.bodyWrapper} width={'100%'}>
        <Flexbox
          data-page-editor-scroll-container
          height={'100%'}
          ref={contentWrapperRef}
          style={styles.contentWrapper}
          width={'100%'}
          onScroll={handleEditorScroll}
        >
          <div data-page-editor-document-column style={styles.documentColumn}>
            <WideScreenContainer
              wrapperStyle={{ cursor: editable ? 'text' : 'default' }}
              onChange={notifyEditorLayoutChange}
              onClick={() => {
                if (!editable) return;

                editor?.focus();
              }}
            >
              <Flexbox className={overrideStyles.editorContent} flex={1} style={editorContentStyle}>
                <TitleSection />
                <PageMetaBar />
                {/* Surfaces local heartbeat health (unstable/lost) for the holder.
                    Suppressed when LockedAlert is showing — see LockStatusBanner. */}
                <LockStatusBanner />
                {/* Prominent in-body notice when another member holds the lock; the
                    compact status badge lives in the Header (EditingIndicator). */}
                <LockedAlert />
                <EditorCanvas
                  activeAnnotationIds={selectedAnnotationIds}
                  askCopilotTarget={askCopilotTarget}
                  rootClassName={overrideStyles.editorRoot}
                  onAnnotationClick={handleAnnotationClick}
                  onComposerChange={handleComposerChange}
                  onRewriteSelection={showRightPanel ? handleRewriteSelection : undefined}
                />
                <PageRewriteBlockMenuPlugin
                  activeNodeIds={activeRewriteNodeIds}
                  editor={editor}
                  roomId={documentId}
                  onRewriteSelection={showRightPanel ? handleRewriteSelection : undefined}
                />
                {/* Draft text uses ranges; atomic cards use a host marker. */}
                <RewriteSelectionHighlightPlugin
                  continuationTarget={draftHighlightVisible ? continuationTarget : null}
                  editor={editor}
                  selection={draftHighlightVisible ? rewriteSelection : null}
                />
                {documentId && <DocumentLikes documentId={documentId} key={documentId} />}
                {documentId && <DocumentComments documentId={documentId} />}
              </Flexbox>
            </WideScreenContainer>
          </div>
          {editor && <PageTableOfContents editor={editor} scrollContainerRef={contentWrapperRef} />}
        </Flexbox>
      </Flexbox>
      {documentId && <DiffAllToolbar documentId={documentId} editor={editor} />}
    </Flexbox>
  );

  if (fullWidthHeader) {
    return (
      <PageAnnotationNavigationProvider
        request={annotationNavigationRequest}
        requestAnnotation={requestAnnotation}
        selectAnnotationIds={selectAnnotationIds}
        selectedAnnotationIds={selectedAnnotationIds}
      >
        <PageAnnotationComposerProvider value={{ composer: annotationComposer }}>
          <PageRewriteComposerProvider value={rewriteComposerValue}>
            <PageAnnotationStorageProvider documentId={documentId} editor={editor}>
              <Flexbox
                height={'100%'}
                style={{ backgroundColor: cssVar.colorBgContainer }}
                width={'100%'}
              >
                {headerSlot}
                <Flexbox horizontal flex={1} style={{ minHeight: 0 }} width={'100%'}>
                  {editorPane}
                  {showRightPanel && <RightPanel />}
                </Flexbox>
              </Flexbox>
            </PageAnnotationStorageProvider>
          </PageRewriteComposerProvider>
        </PageAnnotationComposerProvider>
      </PageAnnotationNavigationProvider>
    );
  }

  return (
    <PageAnnotationNavigationProvider
      request={annotationNavigationRequest}
      requestAnnotation={requestAnnotation}
      selectAnnotationIds={selectAnnotationIds}
      selectedAnnotationIds={selectedAnnotationIds}
    >
      <PageAnnotationComposerProvider value={{ composer: annotationComposer }}>
        <PageRewriteComposerProvider value={rewriteComposerValue}>
          <PageAnnotationStorageProvider documentId={documentId} editor={editor}>
            <Flexbox
              horizontal
              height={'100%'}
              style={{ backgroundColor: cssVar.colorBgContainer }}
              width={'100%'}
            >
              {editorPane}
              {showRightPanel && <RightPanel />}
            </Flexbox>
          </PageAnnotationStorageProvider>
        </PageRewriteComposerProvider>
      </PageAnnotationComposerProvider>
    </PageAnnotationNavigationProvider>
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
  const deletePage = usePageStore((s) => s.deletePage);

  return (
    <PageAgentProvider pageId={pageId} syncActiveAgent={syncPageAgentActiveState}>
      <EditorProvider>
        <PageEditorProvider
          emoji={emoji}
          key={pageId || '__new_page__'}
          knowledgeBaseId={knowledgeBaseId}
          metaReadOnly={metaReadOnly}
          pageId={pageId}
          title={title}
          onBack={onBack}
          onDocumentIdChange={onDocumentIdChange}
          onDelete={() => {
            if (!canEdit) return;

            deletePage(pageId || '');
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
            syncPageAgentActiveState={syncPageAgentActiveState}
          />
        </PageEditorProvider>
      </EditorProvider>
    </PageAgentProvider>
  );
};
