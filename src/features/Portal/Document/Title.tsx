'use client';

import { useEditor } from '@lobehub/editor/react';
import { Flexbox, TextArea } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useDocumentStore } from '@/store/document';
import { useNotebookStore } from '@/store/notebook';
import { notebookSelectors } from '@/store/notebook/selectors';

const Title = memo(() => {
  const { t } = useTranslation('file');
  const editor = useEditor();

  const [topicId, documentId] = useChatStore((s) => [
    s.activeTopicId,
    chatPortalSelectors.portalDocumentId(s),
  ]);

  const document = useNotebookStore(notebookSelectors.getDocumentById(topicId, documentId));
  const [performSave, markDirty] = useDocumentStore((s) => [s.performSave, s.markDirty]);

  // Local state for title
  const [currentTitle, setCurrentTitle] = useState('');

  // Initialize title from document
  useEffect(() => {
    if (document?.title) {
      setCurrentTitle(document.title);
    }
  }, [document?.title]);

  const handleTitleChange = (value: string) => {
    setCurrentTitle(value);
    if (documentId) {
      markDirty(documentId);
    }
  };

  const handleTitleSubmit = async () => {
    if (documentId) {
      await performSave(documentId, { title: currentTitle || undefined });
    }
    editor?.focus();
  };

  return (
    <Flexbox
      gap={16}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      paddingBlock={16}
      style={{
        cursor: 'default',
      }}
    >
      <TextArea
        autoSize={{ minRows: 1 }}
        onChange={(e) => {
          handleTitleChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleTitleSubmit();
          }
        }}
        placeholder={t('pageEditor.titlePlaceholder')}
        style={{
          fontSize: 24,
          fontWeight: 600,
          padding: 0,
          resize: 'none',
          width: '100%',
        }}
        value={currentTitle}
        variant={'borderless'}
      />
    </Flexbox>
  );
});

export default Title;
