'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon, PencilIcon, XIcon } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import CodeEditorPane from '@/components/CodeEditorPane';
import Loading from '@/components/Loading/CircleLoading';
import FileNotFound from '@/features/FileNotFound';
import { FileDocumentPreview } from '@/features/FileViewer/FileDocumentPreview';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { useAgentStore } from '@/store/agent';
import { useDocumentStore } from '@/store/document';
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
import FooterActions from './FooterActions';
import TodoList from './TodoList';
import { useHighlightSave } from './useHighlightSave';

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
            <Button icon={XIcon} size="small" onClick={handleCancel}>
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
  filename: string;
  onSaved: (newContent: string, updatedAt?: string) => void;
  updatedAt?: Date;
}

const HighlightEditor = memo<HighlightEditorProps>(
  ({ content, documentId, filename, onSaved, updatedAt }) => {
    const { editingValue, handleChange, handleSave } = useHighlightSave({
      content,
      documentId,
      onSaved,
      updatedAt,
    });

    // Mirror the live buffer into the document store so consumers outside this
    // component (the portal footer's Export) read the text currently on screen,
    // not the last persisted SWR copy. `addDocument` upserts: the highlight
    // editor path never goes through `useFetchDocument`, so the record may not
    // exist yet. `lastSavedContent` stays at the persisted value so this mirror
    // never marks the document dirty or triggers a save on its own.
    const dispatchDocument = useDocumentStore((s) => s.internal_dispatchDocument);
    const docExists = useDocumentStore((s) => !!s.documents[documentId]);
    useEffect(() => {
      dispatchDocument(
        docExists
          ? { id: documentId, type: 'updateDocument', value: { content: editingValue } }
          : {
              id: documentId,
              type: 'addDocument',
              value: { content: editingValue, lastSavedContent: content, sourceType: 'notebook' },
            },
      );
    }, [content, dispatchDocument, docExists, documentId, editingValue]);

    return (
      <CodeEditorPane
        showStatusBar
        filePath={filename}
        value={editingValue}
        onChange={handleChange}
        onSave={handleSave}
      />
    );
  },
);

HighlightEditor.displayName = 'HighlightEditor';

const DocumentBody = memo(() => {
  const documentId = useResolvedDocumentId();
  const agentDocumentId = useResolvedAgentDocumentId();
  const fullPage = useDocumentViewFullPage();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  // `agentDocumentId` is what marks this as an *agent* document: only the agent-doc
  // openers pass it. The notebook opens plain topic documents with the id alone, and
  // the footer's chat entry (which resolves a doc-anchored topic) must stay out of
  // the way there — `getOrCreateChatTopic` throws NOT_FOUND without the binding row.
  const footerEligible = !fullPage && !!activeAgentId && !!documentId && !!agentDocumentId;
  const [skillFrontmatter, contentFormat] = useDocumentStore((s) =>
    documentId
      ? [s.documents[documentId]?.skillFrontmatter ?? '', s.documents[documentId]?.contentFormat]
      : ['', undefined],
  );
  const isSkillMarkdown = contentFormat === 'skillMarkdown';

  const {
    data: documentMeta,
    error: documentError,
    isLoading: documentLoading,
    mutate: mutateDocumentMeta,
  } = useClientDataSWR(documentId ? portalKeys.documentHeader(documentId) : null, () =>
    documentService.getDocumentById(documentId!),
  );
  const renderMode = documentMeta
    ? getDocumentRenderMode(documentMeta)
    : { mode: 'editor' as const };

  const handleHighlightSaved = useCallback(
    (saved: string, updatedAt?: string) => {
      mutateDocumentMeta(
        (prev) =>
          prev
            ? { ...prev, content: saved, ...(updatedAt ? { updatedAt: new Date(updatedAt) } : {}) }
            : prev,
        { revalidate: false },
      );
    },
    [mutateDocumentMeta],
  );

  const editorContent = (
    <>
      {renderMode.mode !== 'file' && documentId && isSkillMarkdown && (
        <SkillFrontmatterBlock documentId={documentId} frontmatter={skillFrontmatter} />
      )}
      {renderMode.mode === 'file' ? (
        <FileDocumentPreview fileId={documentMeta?.fileId} />
      ) : renderMode.mode === 'highlight' && documentId ? (
        <HighlightEditor
          content={documentMeta?.content ?? ''}
          documentId={documentId}
          filename={documentMeta?.filename ?? ''}
          key={documentId}
          updatedAt={documentMeta?.updatedAt}
          onSaved={handleHighlightSaved}
        />
      ) : (
        <EditorCanvas />
      )}
    </>
  );

  if (documentLoading) return <Loading />;
  if (documentError)
    return (
      <AsyncError
        error={documentError}
        variant={'block'}
        onRetry={() => void mutateDocumentMeta()}
      />
    );
  if (!documentMeta) return <FileNotFound />;

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <div className={fullPage ? styles.contentFull : styles.content}>
        {fullPage && renderMode.mode !== 'file' ? (
          <WideScreenContainer>{editorContent}</WideScreenContainer>
        ) : (
          editorContent
        )}
      </div>
      {renderMode.mode !== 'file' && <TodoList />}
      {/* The compact portal closes with two entry buttons instead of an inline
          conversation: "chat to edit" opens the doc-anchored chat on the right
          panel, "export" downloads the markdown. The full-page route keeps its
          own layout (the working sidebar already provides chat), and plain
          notebook documents have no `agent_documents` row to anchor a chat
          topic, so the footer only renders for agent documents. */}
      {footerEligible && (
        <FooterActions
          agentId={activeAgentId}
          documentId={documentId}
          fileBacked={renderMode.mode === 'file'}
          title={documentMeta?.title ?? documentMeta?.filename ?? undefined}
        />
      )}
    </Flexbox>
  );
});

export default DocumentBody;
