'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { NotebookPenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateNote } from './useCreateNote';

const NotePlaceholder = memo(() => {
  const { t } = useTranslation('note');
  const handleCreate = useCreateNote();

  return (
    <Center height={'100%'} width={'100%'}>
      <Flexbox align={'center'} gap={16}>
        <Icon icon={NotebookPenIcon} size={40} style={{ opacity: 0.4 }} />
        <Flexbox align={'center'} gap={4}>
          <Text weight={500}>{t('placeholder.title')}</Text>
          <Text fontSize={12} type={'secondary'}>
            {t('placeholder.desc')}
          </Text>
        </Flexbox>
        <Button type={'primary'} onClick={handleCreate}>
          {t('list.newNote')}
        </Button>
      </Flexbox>
    </Center>
  );
});

NotePlaceholder.displayName = 'QuickNotePlaceholder';

export default NotePlaceholder;
