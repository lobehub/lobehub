'use client';

import { Center, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const PromptTitle = () => {
  const { t } = useTranslation('image');

  return (
    <Center horizontal gap={16} style={{ width: '100%' }}>
      <Center
        flex={'none'}
        height={54}
        width={54}
        style={{
          backgroundColor: cssVar.colorText,
          borderRadius: 16,
        }}
      >
        <Icon color={cssVar.colorBgLayout} icon={Palette} size={32} />
      </Center>
      <Text
        as={'h1'}
        style={{
          margin: 0,
        }}
      >
        {t('config.header.title')}
      </Text>
    </Center>
  );
};

export default PromptTitle;
