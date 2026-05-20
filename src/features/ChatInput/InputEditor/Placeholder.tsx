import { KeyEnum } from '@lobechat/const/hotkeys';
import { combineKeys, Flexbox, Hotkey } from '@lobehub/ui';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
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

    const agentId = useAgentId();
    const enableAgentMode = useAgentStore(agentByIdSelectors.getAgentEnableModeById(agentId));

    const isHeterogeneous = !!heterogeneousName;

    if (variant === 'followUp') {
      return (
        <span>
          {t(isHeterogeneous ? 'followUpPlaceholderHeterogeneous' : 'followUpPlaceholder')}
        </span>
      );
    }

    const i18nKey = isHeterogeneous
      ? 'sendPlaceholderHeterogeneous'
      : enableAgentMode
        ? showAgentAssignmentHint
          ? 'sendPlaceholderWithAgentAssignment'
          : 'sendPlaceholder'
        : showAgentAssignmentHint
          ? 'sendPlaceholderChatWithAgentAssignment'
          : 'sendPlaceholderChat';

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
