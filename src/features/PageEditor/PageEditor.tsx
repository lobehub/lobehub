'use client';

import { DEFAULT_BLOCK_ANCHOR_PADDING, EditorProvider } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { createStyles, cssVar } from 'antd-style';
import type { CSSProperties, FC, ReactNode, UIEvent } from 'react';
import { memo, useCallback, useEffect, useRef } from 'react';

import { CONVERSATION_MIN_WIDTH } from '@/const/layoutTokens';
import DiffAllToolbar from '@/features/EditorCanvas/DiffAllToolbar';
import PageMetaBar from '@/features/PageEditor/PageMetaBar';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useRegisterFilesHotkeys } from '@/hooks/useHotkeys';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { usePageStore } from '@/store/page';
import { StyleSheet } from '@/utils/styles';

import EditorCanvas from './EditorCanvas';
import Header from './Header';
import { PageAgentProvider } from './PageAgentProvider';
import { PageEditorProvider } from './PageEditorProvider';
import RightPanel from './RightPanel';
import { usePageEditorStore } from './store';
import TitleSection from './TitleSection';

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

const useTableOverrideStyles = createStyles(({ css }) => ({
  editorContent: css`
    .lobe-editor-table-scroll-wrapper.lobe-editor-table-scroll-wrapper {
      --lobe-block-anchor-padding: var(--lobe-pageeditor-table-bleed-inline);

      position: relative;
      box-sizing: border-box;
      width: 100cqi;
      margin-inline: calc(var(--lobe-pageeditor-table-bleed-inline) * -1);
    }

    .lobe-editor-table-scroll-wrapper .editor_table {
      width: max-content;
    }
  `,
}));

interface PageEditorProps {
  emoji?: string;
  /**
   * When true, the header spans the full editor width above the body and the
   * right panel only fills the body area. Defaults to false (header sits in
   * the left column only, right panel runs floor-to-ceiling).
   */
  fullWidthHeader?: boolean;
  header?: PageEditorHeader;
  knowledgeBaseId?: string;
  onBack?: () => void;
  onDelete?: () => void;
  onDocumentIdChange?: (newId: string) => void;
  onEmojiChange?: (emoji: string | undefined) => void;
  onSave?: () => void;
  onTitleChange?: (title: string) => void;
  pageId?: string;
  title?: string;
}

interface PageEditorCanvasProps {
  fullWidthHeader?: boolean;
  header?: PageEditorHeader;
}

const PageEditorCanvas = memo<PageEditorCanvasProps>(({ header, fullWidthHeader }) => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const editor = usePageEditorStore((s) => s.editor);
  const documentId = usePageEditorStore((s) => s.documentId);
  const wideScreen = useGlobalStore(systemStatusSelectors.wideScreen);
  const { styles: overrideStyles } = useTableOverrideStyles();
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
      if (isRestoringScrollRef.current) return;

      const node = event.currentTarget;
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
      <Flexbox
        horizontal
        height={'100%'}
        ref={contentWrapperRef}
        style={styles.contentWrapper}
        width={'100%'}
        onScroll={handleEditorScroll}
      >
        <WideScreenContainer
          wrapperStyle={{ cursor: canEdit ? 'text' : 'not-allowed' }}
          onChange={notifyEditorLayoutChange}
          onClick={() => {
            if (!canEdit) return;

            editor?.focus();
          }}
        >
          <Flexbox className={overrideStyles.editorContent} flex={1} style={editorContentStyle}>
            <TitleSection />
            <PageMetaBar />
            <EditorCanvas />
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
      {documentId && <DiffAllToolbar documentId={documentId} editor={editor} />}
    </Flexbox>
  );

  if (fullWidthHeader) {
    return (
      <Flexbox height={'100%'} style={{ backgroundColor: cssVar.colorBgContainer }} width={'100%'}>
        {headerSlot}
        <Flexbox horizontal flex={1} style={{ minHeight: 0 }} width={'100%'}>
          {editorPane}
          <RightPanel />
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox
      horizontal
      height={'100%'}
      style={{ backgroundColor: cssVar.colorBgContainer }}
      width={'100%'}
    >
      {editorPane}
      <RightPanel />
    </Flexbox>
  );
});

/**
 * Edit a page
 *
 * A reusable component. Should NOT depend on context.
 */
export const PageEditor: FC<PageEditorProps> = ({
  pageId,
  header,
  fullWidthHeader,
  knowledgeBaseId,
  onDocumentIdChange,
  onEmojiChange,
  onSave,
  onTitleChange,
  onBack,
  title,
  emoji,
}) => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const deletePage = usePageStore((s) => s.deletePage);

  return (
    <PageAgentProvider>
      <EditorProvider>
        <PageEditorProvider
          emoji={emoji}
          knowledgeBaseId={knowledgeBaseId}
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
          <PageEditorCanvas fullWidthHeader={fullWidthHeader} header={header} />
        </PageEditorProvider>
      </EditorProvider>
    </PageAgentProvider>
  );
};
