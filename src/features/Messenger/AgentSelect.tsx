'use client';

import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { Select, type SelectProps } from '@lobehub/ui/base-ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { DEFAULT_AVATAR } from '@/const/meta';
import { messengerService } from '@/services/messenger';

interface AgentSelectProps extends Omit<SelectProps<string>, 'options' | 'value' | 'onChange'> {
  onChange?: (agentId: string | undefined) => void;
  value?: string;
}

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
            <Flexbox horizontal align={'center'} gap={8}>
              <Avatar
                avatar={agent.avatar || DEFAULT_AVATAR}
                background={agent.backgroundColor ?? undefined}
                size={20}
              />
              <Text ellipsis>{title}</Text>
            </Flexbox>
          ),
          title,
          value: agent.id,
        };
      }),
    [agentsSWR.data, defaultAgentTitle],
  );

  return (
    <Select
      showSearch
      options={options}
      value={value ?? null}
      onChange={(next) => onChange?.((next as string | null) ?? undefined)}
      {...rest}
    />
  );
});

AgentSelect.displayName = 'MessengerAgentSelect';

export default AgentSelect;
