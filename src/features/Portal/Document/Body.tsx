'use client';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@lobechat/const';
import { ActionIcon, Button, Flexbox, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { debounce } from 'es-toolkit/compat';
import { CheckIcon, PencilIcon, XIcon } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CodeEditorPane from '@/components/CodeEditorPane';
import FloatingChatPanel from '@/features/FloatingChatPanel';
import { useDocumentChatTopic } from '@/features/FloatingChatPanel/useDocumentChatTopic';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { useAgentStore } from '@/store/agent';
import { useDocumentStore } from '@/store/document';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';
import { getDocumentRenderMode } from '@/utils/documentRenderMode';
import {
  getSkillMarkdownMetadataError,
  parseSkillMarkdownFrontmatterFields,
  parseSkillMarkdownMetadata,
} from '@/utils/skillMarkdown';

import {
  useDocumentViewFullPage,
  useResolvedAgentDocumentId,
  useResolvedDocumentId,
} from './documentViewContext';
import EditorCanvas from './EditorCanvas';
import TodoList from './TodoList';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    overflow: auto;
    flex: 1;
    padding-inline: 16px;
  `,
  contentFull: css`
    /* Width is handled by WideScreenContainer; keep only the scroll host. */
    overflow: auto;
    flex: 1;
  `,
  frontmatter: css`
    margin-block: 16px 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
  `,
  metadataKey: css`
    flex-shrink: 0;
    width: 112px;
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextSecondary};
  `,
  metadataRow: css`
    padding-block: 10px;
    padding-inline: 12px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  metadataValue: css`
    min-width: 0;
    white-space: pre-wrap;
  `,
  sectionHeader: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  textArea: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
}));

interface SkillFrontmatterBlockProps {
  documentId: string;
  frontmatter: string;
}

const SkillFrontmatterBlock = memo<SkillFrontmatterBlockProps>(({ documentId, frontmatter }) => {
  const { t } = useTranslation('editor');
  const metadata = useMemo(() => parseSkillMarkdownMetadata(frontmatter), [frontmatter]);
  const currentName = useMemo(
    () => parseSkillMarkdownFrontmatterFields(frontmatter).name,
    [frontmatter],
  );
  const [draft, setDraft] = useState(frontmatter);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [performSave, updateSkillFrontmatter] = useDocumentStore((s) => [
    s.performSave,
    s.updateSkillFrontmatter,
  ]);

  useEffect(() => {
    if (editing) return;
    setDraft(frontmatter);
  }, [editing, frontmatter]);

  const handleEdit = useCallback(() => {
    setDraft(frontmatter);
    setError(undefined);
    setEditing(true);
  }, [frontmatter]);

  const handleCancel = useCallback(() => {
    setDraft(frontmatter);
    setError(undefined);
    setEditing(false);
  }, [frontmatter]);

  const handleSave = useCallback(async () => {
    const nextError = getSkillMarkdownMetadataError(draft, { expectedName: currentName });
    if (nextError) {
      const message =
        nextError.type === 'nameLocked'
          ? t(`skillFrontmatter.invalid.${nextError.type}`, { name: nextError.expectedName })
          : t(`skillFrontmatter.invalid.${nextError.type}`);
      setError(message);
      return;
    }

    setSaving(true);
    try {
      const updated = updateSkillFrontmatter(documentId, draft);
      if (!updated) {
        setError(t('skillFrontmatter.saveFailed'));
        return;
      }

      await performSave(documentId, undefined, { saveSource: 'manual' });
      const latestDocument = useDocumentStore.getState().documents[documentId];
      if (latestDocument?.isDirty) {
        setError(t('skillFrontmatter.saveFailed'));
        return;
      }

      setEditing(false);
      setError(undefined);
    } finally {
      setSaving(false);
    }
  }, [currentName, documentId, draft, performSave, t, updateSkillFrontmatter]);

  return (
    <Flexbox className={styles.frontmatter}>
      <Flexbox horizontal align="center" className={styles.sectionHeader} justify="space-between">
        <Text type="secondary">{t('skillFrontmatter.title')}</Text>
        {editing ? (
          <Flexbox horizontal gap={8}>
            <Button icon={XIcon} size="small" variant="outlined" onClick={handleCancel}>
              {t('cancel')}
            </Button>
            <Button
              icon={CheckIcon}
              loading={saving}
              size="small"
              type="primary"
              onClick={handleSave}
            >
              {t('confirm')}
            </Button>
          </Flexbox>
        ) : (
          <ActionIcon
            icon={PencilIcon}
            size="small"
            title={t('skillFrontmatter.edit')}
            onClick={handleEdit}
          />
        )}
      </Flexbox>
      {editing ? (
        <Flexbox gap={8} padding={12}>
          {/* Raw YAML is only exposed in edit mode so users can keep advanced frontmatter syntax. */}
          <TextArea
            autoSize={{ maxRows: 12, minRows: 4 }}
            className={styles.textArea}
            value={draft}
            variant="borderless"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              setDraft(event.target.value);
              setError(undefined);
            }}
          />
          {error && <Text type="danger">{error}</Text>}
        </Flexbox>
      ) : metadata.length > 0 ? (
        metadata.map((item) => (
          <Flexbox horizontal align="flex-start" className={styles.metadataRow} key={item.key}>
            <Text className={styles.metadataKey}>{item.key}</Text>
            <Text className={styles.metadataValue}>{item.value}</Text>
          </Flexbox>
        ))
      ) : (
        <Flexbox className={styles.metadataRow}>
          <Text type="secondary">{t('skillFrontmatter.empty')}</Text>
        </Flexbox>
      )}
    </Flexbox>
  );
});

interface HighlightEditorProps {
  content: string;
  documentId: string;
  language: string;
  onSaved: (newContent: string) => void;
}

const HighlightEditor = memo<HighlightEditorProps>(({ content, documentId, language, onSaved }) => {
  const [buffer, setBuffer] = useState<string | undefined>(undefined);
  const editingValue = buffer ?? content;

  const bufferRef = useRef(buffer);
  const documentIdRef = useRef(documentId);
  const onSavedRef = useRef(onSaved);
  bufferRef.current = buffer;
  documentIdRef.current = documentId;
  onSavedRef.current = onSaved;

  const writeBuffer = useCallback(async (source: 'manual' | 'autosave') => {
    const toWrite = bufferRef.current;
    if (toWrite === undefined) return;
    try {
      await documentService.updateDocument({
        content: toWrite,
        id: documentIdRef.current,
        saveSource: source,
      });
      // Update SWR cache before clearing the buffer so the editor's value prop
      // never falls back to stale content, which would otherwise reset the cursor.
      onSavedRef.current(toWrite);
      if (bufferRef.current === toWrite) setBuffer(undefined);
    } catch (error) {
      console.error('[HighlightEditor] save failed:', error);
    }
  }, []);

  const debouncedAutoSave = useMemo(
    () =>
      debounce(() => writeBuffer('autosave'), EDITOR_DEBOUNCE_TIME, {
        leading: false,
        maxWait: EDITOR_MAX_WAIT,
        trailing: true,
      }),
    [writeBuffer],
  );

  const handleChange = useCallback(
    (next: string) => {
      const isDirty = next !== content;
      setBuffer(isDirty ? next : undefined);
      if (isDirty) debouncedAutoSave();
      else debouncedAutoSave.cancel();
    },
    [content, debouncedAutoSave],
  );

  const handleSave = useCallback(async () => {
    debouncedAutoSave.cancel();
    await writeBuffer('manual');
  }, [debouncedAutoSave, writeBuffer]);

  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      debouncedAutoSave.cancel();
      const pendingContent = bufferRef.current;
      if (pendingContent === undefined) return;
      const pendingDocumentId = documentIdRef.current;
      // Defer the fire-and-forget save to a microtask so that StrictMode's synchronous
      // unmount/remount in development does not trigger a save. If the component is
      // immediately remounted, isMountedRef flips back to true before this runs.
      queueMicrotask(() => {
        if (isMountedRef.current) return;
        void documentService.updateDocument({
          content: pendingContent,
          id: pendingDocumentId,
          saveSource: 'autosave',
        });
      });
    };
  }, [debouncedAutoSave]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (bufferRef.current === undefined) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  return (
    <CodeEditorPane
      language={language}
      style={{ minHeight: '100%' }}
      value={editingValue}
      onChange={handleChange}
      onSave={handleSave}
    />
  );
});

HighlightEditor.displayName = 'HighlightEditor';

const DocumentBody = memo(() => {
  const documentId = useResolvedDocumentId();
  const agentDocumentId = useResolvedAgentDocumentId();
  const fullPage = useDocumentViewFullPage();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const enableFloatingChatPanel = useUserStore(
    labPreferSelectors.enableAgentDocumentFloatingChatPanel,
  );
  const panelEligible = !fullPage && enableFloatingChatPanel && !!activeAgentId && !!documentId;
  const { topicId: docChatTopicId } = useDocumentChatTopic({
    agentId: panelEligible ? activeAgentId : undefined,
    documentId: panelEligible ? documentId : undefined,
  });
  const [skillFrontmatter, contentFormat] = useDocumentStore((s) =>
    documentId
      ? [s.documents[documentId]?.skillFrontmatter ?? '', s.documents[documentId]?.contentFormat]
      : ['', undefined],
  );
  const isSkillMarkdown = contentFormat === 'skillMarkdown';

  const { data: documentMeta, mutate: mutateDocumentMeta } = useClientDataSWR(
    documentId ? portalKeys.documentHeader(documentId) : null,
    () => documentService.getDocumentById(documentId!),
  );
  const renderMode = documentMeta
    ? getDocumentRenderMode(documentMeta)
    : { mode: 'editor' as const };

  const handleHighlightSaved = useCallback(
    (saved: string) => {
      mutateDocumentMeta((prev) => (prev ? { ...prev, content: saved } : prev), {
        revalidate: false,
      });
    },
    [mutateDocumentMeta],
  );

  const editorContent = (
    <>
      {documentId && isSkillMarkdown && (
        <SkillFrontmatterBlock documentId={documentId} frontmatter={skillFrontmatter} />
      )}
      {renderMode.mode === 'highlight' && documentId ? (
        <HighlightEditor
          content={documentMeta?.content ?? ''}
          documentId={documentId}
          key={documentId}
          language={renderMode.language}
          onSaved={handleHighlightSaved}
        />
      ) : (
        <EditorCanvas />
      )}
    </>
  );

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <div className={fullPage ? styles.contentFull : styles.content}>
        {fullPage ? <WideScreenContainer>{editorContent}</WideScreenContainer> : editorContent}
      </div>
      <TodoList />
      {/* The full-page route hosts its own panel through `AgentDocumentPage`, so
          the in-portal panel only renders for the compact view. Both call sites
          drive a doc-anchored chat topic via `useDocumentChatTopic`, so the panel
          renders once that topic id resolves. */}
      {panelEligible && docChatTopicId && (
        <FloatingChatPanel
          agentDocumentId={agentDocumentId}
          agentId={activeAgentId}
          documentId={documentId ?? undefined}
          key={`${activeAgentId}:${docChatTopicId}:${documentId ?? 'none'}`}
          topicId={docChatTopicId}
        />
      )}
    </Flexbox>
  );
});

export default DocumentBody;
