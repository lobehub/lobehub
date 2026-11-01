'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

const styles = stylex.create({
  row: {
    flex: 'none',
    width: '100%',
    minHeight: '40px',
    paddingBlockStart: '2px',
    paddingBlockEnd: '4px',
    paddingInline: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

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
      className={stylex.props(styles.row).className}
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
