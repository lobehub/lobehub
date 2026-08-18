'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useTheme } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface LoadEarlierProps {
  error?: Error;
  onRetry: () => void;
}

/**
 * Top sentinel row of the cursor-windowed message list. Shows a spinner while
 * the previous rounds load; a failed page renders an explicit inline retry
 * instead of silently re-firing on every scroll event.
 */
const LoadEarlier = memo<LoadEarlierProps>(({ error, onRetry }) => {
  const { t } = useTranslation(['chat', 'common']);
  const theme = useTheme();

  if (error)
    return (
      <Flexbox horizontal align={'center'} gap={8} justify={'center'} padding={8}>
        <span style={{ color: theme.colorTextSecondary, fontSize: 12 }}>
          {t('messageList.loadEarlierFailed')}
        </span>
        <Button size={'small'} onClick={onRetry}>
          {t('retry', { ns: 'common' })}
        </Button>
      </Flexbox>
    );

  return (
    <Flexbox align={'center'} justify={'center'} padding={8}>
      <Icon spin color={theme.colorTextTertiary} icon={Loader2Icon} />
    </Flexbox>
  );
});

LoadEarlier.displayName = 'ConversationLoadEarlier';

export default LoadEarlier;
