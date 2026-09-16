'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { NotebookPenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';

import { useCreateNote } from './useCreateNote';

const NotePlaceholder = memo(() => {
  const { t } = useTranslation('note');
  const handleCreate = useCreateNote();

  return (
    <Flexbox height={'100%'}>
      <NavHeader />
      <Center flex={1} width={'100%'}>
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
    </Flexbox>
  );
});

NotePlaceholder.displayName = 'QuickNotePlaceholder';

export default NotePlaceholder;
