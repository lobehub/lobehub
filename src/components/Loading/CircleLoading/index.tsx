'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default () => {
  const { t } = useTranslation('common');
  return (
    <Center height={'100%'} width={'100%'}>
      <Flexbox align={'center'} gap={8}>
        <div>
          <Icon icon={LoaderCircle} size={'large'} spin />
        </div>
        <Text style={{ letterSpacing: '0.1em' }} type={'secondary'}>
          {t('loading')}
        </Text>
      </Flexbox>
    </Center>
  );
};
