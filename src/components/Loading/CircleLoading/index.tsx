'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const CircleLoading = () => {
  const { t } = useTranslation('common');
  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      <Flexbox align={'center'} gap={8}>
        <div>
          <Icon spin icon={LoaderCircle} size={'large'} />
        </div>
        <Text style={{ letterSpacing: '0.1em' }} type={'secondary'}>
          {t('loading')}
        </Text>
      </Flexbox>
    </div>
  );
};

export default CircleLoading;
