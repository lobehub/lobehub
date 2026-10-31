'use client';

import { ActionIcon, Button, Flexbox, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, PencilIcon, XIcon } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import CodeEditorPane from '@/components/CodeEditorPane';
import { HtmlDocumentFrame } from '@/components/HtmlPreview';
import Loading from '@/components/Loading/CircleLoading';
import FileNotFound from '@/features/FileNotFound';
import { FileDocumentPreview } from '@/features/FileViewer/FileDocumentPreview';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useDocumentStore } from '@/store/document';
import { getDocumentRenderMode } from '@/utils/documentRenderMode';
import {
  getSkillMarkdownMetadataError,
  parseSkillMarkdownFrontmatterFields,
} from '@/utils/skillMarkdown';

import { useDocumentViewFullPage, useResolvedDocumentId } from './documentViewContext';
import EditorCanvas from './EditorCanvas';
import SkillFrontmatterCard from './SkillFrontmatterCard';
import TodoList from './TodoList';
import { useHighlightSave } from './useHighlightSave';

const styles = stylex.create({
  content: { overflow: 'auto', flex: '1', paddingInline: '16px' },
  // Width is handled by WideScreenContainer; keep only the scroll host.
  contentFull: { overflow: 'auto', flex: '1' },
  textArea: { fontFamily: cssVar.fontFamilyCode },
});

interface SkillFrontmatterBlockProps {
  documentId: string;
  frontmatter: string;
}

const SkillFrontmatterBlock = memo<SkillFrontmatterBlockProps>(({ documentId, frontmatter }) => {
  const { t } = useTranslation('editor');
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
    <SkillFrontmatterCard
      frontmatter={frontmatter}
      extra={
        editing ? (
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
        )
      }
    >
      {editing && (
        <Flexbox gap={8} padding={12}>
          {/* Raw YAML is only exposed in edit mode so users can keep advanced frontmatter syntax. */}
          <TextArea
            autoSize={{ maxRows: 12, minRows: 4 }}
            className={stylex.props(styles.textArea).className}
            value={draft}
            variant="borderless"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              setDraft(event.target.value);
              setError(undefined);
            }}
          />
          {error && <Text type="danger">{error}</Text>}
        </Flexbox>
      )}
    </SkillFrontmatterCard>
  );
});

interface HighlightEditorProps {
  content: string;
  documentId: string;
  filename: string;
  onSaveStart: () => (newContent: string, updatedAt?: string) => void;
  updatedAt?: Date;
}

const HighlightEditor = memo<HighlightEditorProps>(
  ({ content, documentId, filename, onSaveStart, updatedAt }) => {
    const { editingValue, handleChange, handleSave } = useHighlightSave({
      content,
      documentId,
      onSaveStart,
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
  const fullPage = useDocumentViewFullPage();
  const [skillFrontmatter, contentFormat] = useDocumentStore((s) =>
    documentId
      ? [s.documents[documentId]?.skillFrontmatter ?? '', s.documents[documentId]?.contentFormat]
      : ['', undefined],
  );
  const isSkillMarkdown = contentFormat === 'skillMarkdown';

  const useFetchDocumentDetail = useDocumentStore((s) => s.useFetchDocumentDetail);
  const beginDocumentDetailPatch = useDocumentStore((s) => s.beginDocumentDetailPatch);
  const {
    data: documentMeta,
    error: documentError,
    isHydrated: documentHydrated,
    isLoading: documentLoading,
    mutate: mutateDocumentMeta,
  } = useFetchDocumentDetail(documentId);
  const renderMode = documentMeta
    ? getDocumentRenderMode(documentMeta)
    : { mode: 'editor' as const };

  // Captured when the save starts, so a save that settles after an account /
  // workspace switch never lands in the new identity's replica.
  const handleHighlightSaveStart = useCallback(() => {
    if (!documentId) return () => {};
    const commit = beginDocumentDetailPatch(documentId);
    return (saved: string, updatedAt?: string) =>
      commit({ content: saved, ...(updatedAt ? { updatedAt: new Date(updatedAt) } : {}) });
  }, [documentId, beginDocumentDetailPatch]);

  const editorContent = (
    <>
      {renderMode.mode !== 'file' && documentId && isSkillMarkdown && (
        <SkillFrontmatterBlock documentId={documentId} frontmatter={skillFrontmatter} />
      )}
      {renderMode.mode === 'file' ? (
        <FileDocumentPreview fileId={documentMeta?.fileId} />
      ) : renderMode.mode === 'html' ? (
        <HtmlDocumentFrame
          content={documentMeta?.content ?? ''}
          title={documentMeta?.title ?? undefined}
        />
      ) : renderMode.mode === 'highlight' && documentId ? (
        <HighlightEditor
          content={documentMeta?.content ?? ''}
          documentId={documentId}
          filename={documentMeta?.filename ?? ''}
          key={documentId}
          updatedAt={documentMeta?.updatedAt}
          onSaveStart={handleHighlightSaveStart}
        />
      ) : (
        <EditorCanvas />
      )}
    </>
  );

  // The persisted row is still being read: paint nothing rather than a spinner
  // that the cached document replaces a few frames later.
  if (documentLoading) return documentHydrated ? <Loading /> : null;
  // The document is a persisted replica (stale-while-revalidate): a transient
  // refresh failure keeps the cached document on screen. A denial (FORBIDDEN /
  // UNAUTHORIZED) purges the cached row, so it lands here with no data.
  if (documentError && !documentMeta)
    return (
      <AsyncError
        error={documentError}
        variant={'page'}
        onRetry={() => void mutateDocumentMeta()}
      />
    );
  if (!documentMeta) return <FileNotFound />;

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <div {...stylex.props(fullPage ? styles.contentFull : styles.content)}>
        {fullPage && renderMode.mode !== 'file' ? (
          <WideScreenContainer>{editorContent}</WideScreenContainer>
        ) : (
          editorContent
        )}
      </div>
      {renderMode.mode !== 'file' && <TodoList />}
    </Flexbox>
  );
});

export default DocumentBody;
