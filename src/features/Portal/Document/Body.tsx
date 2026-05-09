'use client';

import { ActionIcon, Button, Flexbox, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon, PencilIcon, XIcon } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useDocumentStore } from '@/store/document';
import {
  getSkillMarkdownMetadataError,
  parseSkillMarkdownFrontmatterFields,
  parseSkillMarkdownMetadata,
} from '@/utils/skillMarkdown';

import EditorCanvas from './EditorCanvas';
import TodoList from './TodoList';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    overflow: auto;
    flex: 1;
    padding-inline: 16px;
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
  todoContainer: css`
    flex-shrink: 0;
    padding-block-end: 12px;
    padding-inline: 12px;
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

const DocumentBody = memo(() => {
  const documentId = useChatStore(chatPortalSelectors.portalDocumentId);
  const [skillFrontmatter, contentFormat] = useDocumentStore((s) =>
    documentId
      ? [s.documents[documentId]?.skillFrontmatter ?? '', s.documents[documentId]?.contentFormat]
      : ['', undefined],
  );
  const isSkillMarkdown = contentFormat === 'skillMarkdown';

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <div className={styles.content}>
        {documentId && isSkillMarkdown && (
          <SkillFrontmatterBlock documentId={documentId} frontmatter={skillFrontmatter} />
        )}
        <EditorCanvas />
      </div>
      <div className={styles.todoContainer}>
        <TodoList />
      </div>
    </Flexbox>
  );
});

export default DocumentBody;
