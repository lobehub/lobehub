'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

const styles = createStaticStyles(({ css }) => ({
  row: css`
    flex: none;

    width: 100%;
    min-height: 40px;
    padding-block: 4px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
}));

interface RefreshErrorProps {
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}

export const RefreshError = memo<RefreshErrorProps>(({ error, onRetry, retrying }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox
      horizontal
      align={'center'}
      aria-live={'polite'}
      className={styles.row}
      justify={'center'}
      role={'status'}
    >
      <AsyncError
        error={error}
        retrying={retrying}
        title={t('chatList.refreshError')}
        variant={'inline'}
        onRetry={onRetry}
      />
    </Flexbox>
  );
});

RefreshError.displayName = 'ConversationRefreshError';
