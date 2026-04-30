'use client';

import { Avatar, Flexbox, Select, type SelectProps, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { DEFAULT_AVATAR } from '@/const/meta';
import { messengerService } from '@/services/messenger';

interface AgentSelectProps extends Omit<
  SelectProps,
  'options' | 'showSearch' | 'optionFilterProp' | 'value' | 'onChange'
> {
  onChange?: (agentId: string | undefined) => void;
  value?: string;
}

/**
 * Shared agent picker used wherever the messenger feature asks the user to
 * pick which agent receives messages. Single source of truth for the option
 * shape (avatar + title, locale-aware fallback) so verify-im and the Settings
 * panel render identically. Fetches `messenger.listAgentsForBinding` (which
 * already pins LobeAI to the top and matches the bot's `/agents` ordering).
 */
const AgentSelect = memo<AgentSelectProps>(({ value, onChange, ...rest }) => {
  const { t: tCommon } = useTranslation('common');
  const agentsSWR = useSWR('messenger:agentsForBinding', () =>
    messengerService.listAgentsForBinding(),
  );

  const defaultAgentTitle = tCommon('defaultSession');
  const options = useMemo(
    () =>
      (agentsSWR.data ?? []).map((agent) => {
        const title = agent.title || defaultAgentTitle;
        return {
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <Avatar
                avatar={agent.avatar || DEFAULT_AVATAR}
                background={agent.backgroundColor ?? undefined}
                size={20}
              />
              <Text ellipsis>{title}</Text>
            </Flexbox>
          ),
          searchValue: title,
          title,
          value: agent.id,
        };
      }),
    [agentsSWR.data, defaultAgentTitle],
  );

  return (
    <Select
      optionFilterProp="searchValue"
      options={options}
      value={value}
      onChange={(next) => onChange?.(next as string | undefined)}
      {...rest}
    />
  );
});

AgentSelect.displayName = 'MessengerAgentSelect';

export default AgentSelect;
