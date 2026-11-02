'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useQuickNoteStore } from '@/store/quickNote';

/** Renders the shared settled error state for Quick Note list surfaces. */
const LoadError = memo(() => {
  const { t } = useTranslation('note');
  const initNotes = useQuickNoteStore((s) => s.initNotes);

  return (
    <Flexbox align={'center'} gap={8} paddingBlock={24} paddingInline={16}>
      <Text align={'center'} type={'danger'}>
        {t('list.loadFailed')}
      </Text>
      <Button type={'text'} onClick={initNotes}>
        {t('list.retryLoad')}
      </Button>
    </Flexbox>
  );
});

LoadError.displayName = 'QuickNoteLoadError';

export default LoadError;
