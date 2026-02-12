'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { EditorProvider } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { FC } from 'react';
import { memo, useEffect } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import DiffAllToolbar from '@/features/EditorCanvas/DiffAllToolbar';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useRegisterFilesHotkeys } from '@/hooks/useHotkeys';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';
import { usePageStore } from '@/store/page';
import { StyleSheet } from '@/utils/styles';

import Copilot from './Copilot';
import EditorCanvas from './EditorCanvas';
import Header from './Header';
import PageAgentProvider from './PageAgentProvider';
import { PageEditorProvider } from './PageEditorProvider';
import PageTitle from './PageTitle';
import { usePageEditorStore } from './store';
import TitleSection from './TitleSection';

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

const PageEditorCanvas = memo(() => {
  const editor = usePageEditorStore((s) => s.editor);
  const documentId = usePageEditorStore((s) => s.documentId);

  // Get isDirty from DocumentStore
  const isDirty = useDocumentStore((s) =>
    documentId ? editorSelectors.isDirty(documentId)(s) : false,
  );

  // Register Files scope and save document hotkey
  useRegisterFilesHotkeys();

  // Warn user before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        // Prevent default and show browser confirmation dialog
        e.preventDefault();
        // Most modern browsers require returnValue to be set
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);

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
          <Header />
          <Flexbox horizontal height={'100%'} style={styles.contentWrapper} width={'100%'}>
            <WideScreenContainer wrapperStyle={{ cursor: 'text' }} onClick={() => editor?.focus()}>
              <Flexbox flex={1} style={styles.editorContent}>
                <TitleSection />
                <EditorCanvas />
              </Flexbox>
            </WideScreenContainer>
          </Flexbox>
          {documentId && <DiffAllToolbar documentId={documentId} editor={editor!} />}
        </Flexbox>
        <Copilot />
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
  knowledgeBaseId,
  onDocumentIdChange,
  onEmojiChange,
  onSave,
  onTitleChange,
  onBack,
  title,
  emoji,
}) => {
  const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
  const pageAgentId = useAgentStore(builtinAgentSelectors.pageAgentId);

  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.pageAgent);

  const deletePage = usePageStore((s) => s.deletePage);

  if (!pageAgentId) return <Loading debugId="PageEditor > PageAgent Init" />;

  return (
    <PageAgentProvider pageAgentId={pageAgentId}>
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
          <PageEditorCanvas />
        </PageEditorProvider>
      </EditorProvider>
    </PageAgentProvider>
  );
};
