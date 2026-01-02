'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDocumentEditorStore } from './store';

const Title = memo(() => {
  const { t } = useTranslation('file');

  const currentTitle = useDocumentEditorStore((s) => s.currentTitle);
  const setCurrentTitle = useDocumentEditorStore((s) => s.setCurrentTitle);
  const handleTitleSubmit = useDocumentEditorStore((s) => s.handleTitleSubmit);

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
          setCurrentTitle(e.target.value);
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
