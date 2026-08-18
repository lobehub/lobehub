'use client';

import { Center, Empty, Flexbox, ScrollArea } from '@lobehub/ui';
import { Button, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { FileClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { CHANGELOG_PATH } from '@/const/url';
import { useChangelogIndex } from '@/features/Changelog/useChangelogIndex';

import ChangelogContent from './ChangelogContent';

const SCROLL_HEIGHT = 'min(80vh, 760px)';

const styles = createStaticStyles(({ css, cssVar }) => ({
  footer: css`
    padding: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const ChangelogModalContent = memo(() => {
  const { t } = useTranslation(['common', 'changelog']);
  const navigate = useNavigate();
  const { close } = useModalContext();
  const { data, error, isLoading, retry } = useChangelogIndex();

  const openFullChangelog = () => {
    close();
    navigate(CHANGELOG_PATH);
  };

  return (
    <Flexbox>
      <ScrollArea scrollFade style={{ height: SCROLL_HEIGHT }}>
        {isLoading ? (
          <Center style={{ height: SCROLL_HEIGHT }}>
            <NeuralNetworkLoading />
          </Center>
        ) : error ? (
          <Center style={{ height: SCROLL_HEIGHT }}>
            <Flexbox align={'center'} gap={16}>
              <Empty description={t('loadError', { ns: 'changelog' })} icon={FileClockIcon} />
              <Button onClick={() => retry()}>{t('retry')}</Button>
            </Flexbox>
          </Center>
        ) : !data || data.length === 0 ? (
          <Center style={{ height: SCROLL_HEIGHT }}>
            <Empty description={t('empty', { ns: 'changelog' })} icon={FileClockIcon} />
          </Center>
        ) : (
          <Flexbox gap={16} padding={16} style={{ width: '100%' }}>
            <ChangelogContent linkTitles data={data} />
          </Flexbox>
        )}
      </ScrollArea>
      <Flexbox className={styles.footer}>
        <Button block onClick={openFullChangelog}>
          {t('allChangelog', { ns: 'changelog' })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

ChangelogModalContent.displayName = 'ChangelogModalContent';

export default ChangelogModalContent;
