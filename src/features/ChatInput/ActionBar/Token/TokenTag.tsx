import { TokenTag } from '@lobehub/ui/chat';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ActionPopover from '../components/ActionPopover';
import TokenDetails from './TokenDetails';
import { useTokenBreakdown } from './useTokenBreakdown';

const Token = memo(() => {
  const { t } = useTranslation('chat');

  const breakdown = useTokenBreakdown();
  const { maxTokens, totalToken } = breakdown;
  const content = useMemo(() => <TokenDetails breakdown={breakdown} />, [breakdown]);

  // Keep the composer quiet until context pressure is real.
  if (maxTokens > 0 && totalToken / maxTokens <= 0.5) return null;

  return (
    <ActionPopover content={content}>
      <TokenTag
        maxValue={maxTokens}
        mode={'used'}
        value={totalToken}
        size={{
          blockSize: 28,
          size: 18,
        }}
        text={{
          overload: t('tokenTag.overload'),
          remained: t('tokenTag.remained'),
          used: t('tokenTag.used'),
        }}
      />
    </ActionPopover>
  );
});

Token.displayName = 'ContextWindowToken';

export default Token;
