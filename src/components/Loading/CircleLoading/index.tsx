'use client';

import { Center, Flexbox, Spin, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

const CircleLoading = () => {
  const { t } = useTranslation('common');
  return (
    <Center height={'100%'} width={'100%'}>
      <Flexbox align={'center'} gap={8}>
        <div>
          <Spin size="large" />
        </div>
        <Text style={{ letterSpacing: '0.1em' }} type={'secondary'}>
          {t('loading')}
        </Text>
      </Flexbox>
    </Center>
  );
};

export default CircleLoading;
