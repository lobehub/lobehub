'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { FileClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ChangelogContent from '@/components/ChangelogModal/ChangelogContent';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useAicoPanelContainerProps } from '@/features/AicoPanels';
import SettingContainer from '@/features/Setting/SettingContainer';

import { useChangelogIndex } from './useChangelogIndex';

const styles = createStaticStyles(({ css }) => ({
  title: css`
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    line-height: 1.3;
  `,
}));

const ChangelogPage = memo(() => {
  const { t } = useTranslation(['changelog', 'common']);
  const containerProps = useAicoPanelContainerProps(800);
  const { data, error, isLoading, retry } = useChangelogIndex();

  return (
    <SettingContainer {...containerProps}>
      <Flexbox gap={24} padding={16} width={'100%'}>
        <Flexbox gap={8}>
          <h1 className={styles.title}>{t('title')}</h1>
          <Text type={'secondary'}>{t('description', { appName: BRANDING_NAME })}</Text>
        </Flexbox>

        {isLoading ? (
          <Center style={{ minHeight: '40vh' }}>
            <NeuralNetworkLoading />
          </Center>
        ) : error ? (
          <Center style={{ minHeight: '40vh' }}>
            <Flexbox align={'center'} gap={16}>
              <Empty description={t('loadError')} icon={FileClockIcon} />
              <Button onClick={() => retry()}>{t('retry', { ns: 'common' })}</Button>
            </Flexbox>
          </Center>
        ) : !data || data.length === 0 ? (
          <Center style={{ minHeight: '40vh' }}>
            <Empty description={t('empty')} icon={FileClockIcon} />
          </Center>
        ) : (
          <ChangelogContent linkTitles data={data} />
        )}
      </Flexbox>
    </SettingContainer>
  );
});

ChangelogPage.displayName = 'ChangelogPage';

export default ChangelogPage;
