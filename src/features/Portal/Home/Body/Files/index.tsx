import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileList from './FileList';

export const Files = memo(() => {
  const { t } = useTranslation('portal');

  return (
    <Flexbox gap={8}>
      <Text as={'h5'} style={{ marginInline: 12 }}>
        {t('files')}
      </Text>
      <FileList />
    </Flexbox>
  );
});

export default Files;
