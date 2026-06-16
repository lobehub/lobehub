'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    pointer-events: none;

    min-height: 16px;
    padding-block: 0 24px;

    font-size: 12px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};
  `,
  loader: css`
    opacity: 0.58;
  `,
}));

const RefreshingHint = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox
      horizontal
      align={'center'}
      aria-live={'polite'}
      className={styles.container}
      gap={6}
      justify={'center'}
      role={'status'}
    >
      <span className={styles.loader}>
        <NeuralNetworkLoading size={12} />
      </span>
      <span>{t('chatList.refreshing')}</span>
    </Flexbox>
  );
});

RefreshingHint.displayName = 'ConversationRefreshingHint';

export default RefreshingHint;
