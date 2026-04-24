import { KeyEnum } from '@lobechat/const/hotkeys';
import { combineKeys, Flexbox, Hotkey } from '@lobehub/ui';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

export type PlaceholderVariant = 'default' | 'followUp';

interface PlaceholderProps {
  heterogeneousName?: string;
  showAgentAssignmentHint?: boolean;
  variant?: PlaceholderVariant;
}

const Placeholder = memo<PlaceholderProps>(
  ({ heterogeneousName, showAgentAssignmentHint = false, variant = 'default' }) => {
    const useCmdEnterToSend = useUserStore(preferenceSelectors.useCmdEnterToSend);
    const wrapperShortcut = useCmdEnterToSend
      ? KeyEnum.Enter
      : combineKeys([KeyEnum.Mod, KeyEnum.Enter]);
    const { t } = useTranslation('chat');

    if (variant === 'followUp') {
      return <span>{t('followUpPlaceholder')}</span>;
    }

    const isHeterogeneous = !!heterogeneousName;
    const i18nKey = isHeterogeneous
      ? 'sendPlaceholderHeterogeneous'
      : showAgentAssignmentHint
        ? 'sendPlaceholderWithAgentAssignment'
        : 'sendPlaceholder';

    return (
      <Flexbox horizontal align={'center'} as={'span'} gap={4} wrap={'wrap'}>
        <Trans
          i18nKey={i18nKey}
          ns={'chat'}
          values={isHeterogeneous ? { name: heterogeneousName } : undefined}
          components={{
            hotkey: (
              <Trans
                i18nKey={'input.warpWithKey'}
                ns={'chat'}
                components={{
                  key: (
                    <Hotkey
                      as={'span'}
                      keys={wrapperShortcut}
                      style={{ color: 'inherit' }}
                      styles={{ kbdStyle: { color: 'inhert' } }}
                      variant={'borderless'}
                    />
                  ),
                }}
              />
            ),
          }}
        />
        {!showAgentAssignmentHint && !isHeterogeneous && '...'}
      </Flexbox>
    );
  },
);

export default Placeholder;
