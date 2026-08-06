import { TokenTag } from '@lobehub/ui/chat';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import ActionPopover from '../components/ActionPopover';
import TokenDetails from './TokenDetails';
import { useTokenBreakdown } from './useTokenBreakdown';

// Module-scope element keeps ActionPopover's `content` referentially stable so
// tag updates can't cascade a rebuild of the details panel; the popover mounts
// it (and its own counting) only while open.
const content = <TokenDetails />;

const Token = memo(() => {
  const { t } = useTranslation('chat');

  const { maxTokens, totalToken } = useTokenBreakdown();
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  // Keep the composer quiet for regular users until context pressure is real;
  // dev mode always shows the tag for inspection.
  if (!isDevMode && maxTokens > 0 && totalToken / maxTokens <= 0.5) return null;

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
