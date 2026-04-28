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
  header?: PageEditorHeader;
}

const PageEditorCanvas = memo<PageEditorCanvasProps>(({ header }) => {
  const editor = usePageEditorStore((s) => s.editor);
  const documentId = usePageEditorStore((s) => s.documentId);

  // Register Files scope and save document hotkey
  useRegisterFilesHotkeys();

  const headerSlot = header === undefined ? <Header /> : header;

  return (
    <>
      <PageTitle />
      <Flexbox
        horizontal
        height={'100%'}
        style={{ backgroundColor: cssVar.colorBgContainer }}
        width={'100%'}
      >
        <Flexbox flex={1} height={'100%'} style={styles.editorContainer}>
          {headerSlot}
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
          <PageEditorCanvas header={header} />
        </PageEditorProvider>
      </EditorProvider>
    </PageAgentProvider>
  );
};
