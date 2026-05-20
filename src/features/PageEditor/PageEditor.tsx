'use client';

import { EditorProvider } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { FC, ReactNode } from 'react';
import { memo } from 'react';

import DiffAllToolbar from '@/features/EditorCanvas/DiffAllToolbar';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useRegisterFilesHotkeys } from '@/hooks/useHotkeys';
import { usePageStore } from '@/store/page';
import { StyleSheet } from '@/utils/styles';

import EditorCanvas from './EditorCanvas';
import Header from './Header';
import { PageAgentProvider } from './PageAgentProvider';
import { PageEditorProvider } from './PageEditorProvider';
import PageTitle from './PageTitle';
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

const styles = StyleSheet.create({
  contentWrapper: {
    display: 'flex',
    overflowY: 'auto',
    position: 'relative',
  },
  editorContainer: {
    minWidth: 0,
    position: 'relative',
  },
  editorContent: {
    overflowY: 'auto',
    position: 'relative',
  },
});

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
  const editor = usePageEditorStore((s) => s.editor);
  const documentId = usePageEditorStore((s) => s.documentId);

  // Register Files scope and save document hotkey
  useRegisterFilesHotkeys();

  const headerSlot = header === undefined ? <Header /> : header;

  const editorPane = (
    <Flexbox flex={1} height={'100%'} style={styles.editorContainer}>
      {!fullWidthHeader && headerSlot}
      <Flexbox horizontal height={'100%'} style={styles.contentWrapper} width={'100%'}>
        <WideScreenContainer wrapperStyle={{ cursor: 'text' }} onClick={() => editor?.focus()}>
          <Flexbox flex={1} style={styles.editorContent}>
            <TitleSection />
            <EditorCanvas />
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
      {documentId && <DiffAllToolbar documentId={documentId} editor={editor} />}
    </Flexbox>
  );

  if (fullWidthHeader) {
    return (
      <>
        <PageTitle />
        <Flexbox
          height={'100%'}
          style={{ backgroundColor: cssVar.colorBgContainer }}
          width={'100%'}
        >
          {headerSlot}
          <Flexbox horizontal flex={1} style={{ minHeight: 0 }} width={'100%'}>
            {editorPane}
            <RightPanel />
          </Flexbox>
        </Flexbox>
      </>
    );
  }

  return (
    <>
      <PageTitle />
      <Flexbox
        horizontal
        height={'100%'}
        style={{ backgroundColor: cssVar.colorBgContainer }}
        width={'100%'}
      >
        {editorPane}
        <RightPanel />
      </Flexbox>
    </>
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
          onDelete={() => deletePage(pageId || '')}
          onDocumentIdChange={onDocumentIdChange}
          onEmojiChange={onEmojiChange}
          onSave={onSave}
          onTitleChange={onTitleChange}
        >
          <PageEditorCanvas fullWidthHeader={fullWidthHeader} header={header} />
        </PageEditorProvider>
      </EditorProvider>
    </PageAgentProvider>
  );
};
