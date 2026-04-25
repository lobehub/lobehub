'use client';

import type { IEditor } from '@lobehub/editor';
import { EditorProvider, useEditor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import debug from 'debug';
import type { CSSProperties } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { DiffAllToolbar, EditorCanvas as SharedEditorCanvas } from '@/features/EditorCanvas';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useRegisterFilesHotkeys } from '@/hooks/useHotkeys';
import { documentHistoryQueueService } from '@/services/documentHistoryQueue';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';
import { StyleSheet } from '@/utils/styles';

import TitleSection, { type TitleSectionProps } from './TitleSection';

const log = debug('lobe-client:topic-canvas');

const styles = StyleSheet.create({
  contentWrapper: {
    display: 'flex',
    position: 'relative',
  },
  editorContainer: {
    minWidth: 0,
    position: 'relative',
  },
  editorContent: {
    paddingBlock: 16,
    position: 'relative',
  },
  root: {
    background: cssVar.colorBgContainer,
    borderRadius: 12,
    overflow: 'hidden',
  },
});

export interface TopicCanvasProps extends TitleSectionProps {
  agentId?: string;
  documentId?: string;
  placeholder?: string;
  style?: CSSProperties;
  topicId?: string | null;
}

type PageAgentEditor = NonNullable<Parameters<typeof pageAgentRuntime.setEditor>[0]>;

const PAGE_AGENT_DATA_SOURCE_TYPES = ['json', 'litexml', 'markdown'] as const;
const PAGE_AGENT_READY_RETRY_LIMIT = 30;
const PAGE_AGENT_READY_RETRY_INTERVAL = 16;

interface InspectableEditor extends IEditor {
  dataTypeMap?: Map<string, unknown> | Record<string, unknown>;
}

const getEditorDataSourceTypes = (editor: InspectableEditor): string[] => {
  const dataTypeMap = editor.dataTypeMap;

  if (!dataTypeMap) return [];

  if (dataTypeMap instanceof Map) {
    return [...dataTypeMap.keys()].sort();
  }

  return Object.keys(dataTypeMap).sort();
};

const getPageAgentEditorSnapshot = (editor: IEditor | undefined) => {
  if (!editor) {
    return {
      dataSourceTypes: [],
      hasLexicalEditor: false,
      isReady: false,
    };
  }

  const dataSourceTypes = getEditorDataSourceTypes(editor as InspectableEditor);
  const hasLexicalEditor = !!editor.getLexicalEditor?.();

  return {
    dataSourceTypes,
    hasLexicalEditor,
    isReady:
      hasLexicalEditor &&
      PAGE_AGENT_DATA_SOURCE_TYPES.every((type) => dataSourceTypes.includes(type)),
  };
};

const TopicCanvasPageAgentBridge = memo<
  Pick<TopicCanvasProps, 'documentId' | 'onTitleChange' | 'title'> & {
    editor: IEditor | undefined;
    editorReady: boolean;
  }
>(({ documentId, editor, editorReady, onTitleChange, title }) => {
  const pageAgentEditor = editor as unknown as PageAgentEditor | undefined;
  const titleRef = useRef(title ?? '');
  const onTitleChangeRef = useRef(onTitleChange);

  useEffect(() => {
    titleRef.current = title ?? '';
  }, [title]);

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  useEffect(() => {
    if (editorReady && pageAgentEditor) {
      log('[TopicCanvas/PageAgentBridge] setEditor', {
        dataSourceTypes: getPageAgentEditorSnapshot(editor).dataSourceTypes,
        documentId,
        editorReady,
        hasLexicalEditor: !!pageAgentEditor.getLexicalEditor?.(),
      });
      pageAgentRuntime.setEditor(pageAgentEditor);
    }

    return () => {
      log('[TopicCanvas/PageAgentBridge] clearEditor', { documentId });
      pageAgentRuntime.setEditor(null);
    };
  }, [documentId, editor, editorReady, pageAgentEditor]);

  useEffect(() => {
    log('[TopicCanvas/PageAgentBridge] bindDocumentContext', {
      dataSourceTypes: getPageAgentEditorSnapshot(editor).dataSourceTypes,
      documentId,
      hasEditor: !!editor,
    });
    pageAgentRuntime.setCurrentDocId(documentId);
    pageAgentRuntime.setTitleHandlers(
      (nextTitle) => {
        titleRef.current = nextTitle;
        onTitleChangeRef.current?.(nextTitle);
      },
      () => titleRef.current,
    );
    pageAgentRuntime.setBeforeMutateHandler(() => {
      log('[TopicCanvas/PageAgentBridge] beforeMutate', {
        dataSourceTypes: getPageAgentEditorSnapshot(editor).dataSourceTypes,
        documentId,
        hasEditor: !!editor,
      });
      documentHistoryQueueService.enqueueEditorSnapshot({ documentId, editor });
    });

    return () => {
      log('[TopicCanvas/PageAgentBridge] clearDocumentContext', { documentId });
      pageAgentRuntime.setCurrentDocId(undefined);
      pageAgentRuntime.setTitleHandlers(null, null);
      pageAgentRuntime.setBeforeMutateHandler(null);
      void documentHistoryQueueService.flush();
    };
  }, [documentId, editor]);

  return null;
});

TopicCanvasPageAgentBridge.displayName = 'TopicCanvasPageAgentBridge';

const TopicCanvasBody = memo<TopicCanvasProps>(
  ({ placeholder, style, title, documentId, onTitleChange, topicId }) => {
    const editor = useEditor();
    const [editorReady, setEditorReady] = useState(false);
    const readyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const previousEditorContextRef = useRef<{ documentId?: string; editor?: IEditor } | undefined>(
      undefined,
    );

    useRegisterFilesHotkeys();

    useEffect(() => {
      const previous = previousEditorContextRef.current;

      if (previous && (previous.documentId !== documentId || previous.editor !== editor)) {
        setEditorReady(false);
        if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
      }

      previousEditorContextRef.current = { documentId, editor };
    }, [documentId, editor]);

    useEffect(() => {
      return () => {
        if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
      };
    }, []);

    const handleEditorInit = useCallback(
      (editorInstance: IEditor) => {
        let retryCount = 0;

        if (readyTimerRef.current) clearTimeout(readyTimerRef.current);

        const markReadyWhenAvailable = () => {
          const snapshot = getPageAgentEditorSnapshot(editorInstance);

          log('[TopicCanvas] editor:onInit', {
            ...snapshot,
            documentId,
            retryCount,
          });

          if (snapshot.isReady) {
            setEditorReady(true);
            return;
          }

          if (retryCount >= PAGE_AGENT_READY_RETRY_LIMIT) {
            console.warn('[TopicCanvas] Page agent editor is not ready:', {
              ...snapshot,
              documentId,
            });
            return;
          }

          retryCount += 1;
          readyTimerRef.current = setTimeout(
            markReadyWhenAvailable,
            PAGE_AGENT_READY_RETRY_INTERVAL,
          );
        };

        markReadyWhenAvailable();
      },
      [documentId],
    );

    return (
      <>
        <TopicCanvasPageAgentBridge
          documentId={documentId}
          editor={editor}
          editorReady={editorReady}
          title={title}
          onTitleChange={onTitleChange}
        />
        <Flexbox
          horizontal
          style={styles.contentWrapper}
          width={'100%'}
          onClick={() => editor?.focus()}
        >
          <Flexbox flex={1} style={styles.editorContainer}>
            <WideScreenContainer wrapperStyle={{ cursor: 'text' }}>
              <Flexbox flex={1} style={styles.editorContent}>
                <TitleSection title={title} onTitleChange={onTitleChange} />
                <SharedEditorCanvas
                  documentId={documentId}
                  editor={editor}
                  placeholder={placeholder}
                  sourceType={'notebook'}
                  style={style}
                  topicId={topicId}
                  onInit={handleEditorInit}
                />
              </Flexbox>
            </WideScreenContainer>
            {documentId && editor && <DiffAllToolbar documentId={documentId} editor={editor} />}
          </Flexbox>
        </Flexbox>
      </>
    );
  },
);

TopicCanvasBody.displayName = 'TopicCanvasBody';

/**
 * TopicCanvas
 *
 * Document canvas for a Topic. Mirrors PageEditor's editor-region layout but
 * without the page chrome (header, title, right panel). Renders an empty
 * editor; topic-document data wiring (fetch/auto-save) is intentionally
 * deferred.
 */
const TopicCanvas = memo<TopicCanvasProps>((props) => {
  return (
    <Flexbox style={styles.root} width={'100%'}>
      <EditorProvider>
        <TopicCanvasBody {...props} />
      </EditorProvider>
    </Flexbox>
  );
});

TopicCanvas.displayName = 'TopicCanvas';

export default TopicCanvas;
