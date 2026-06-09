'use client';

import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { Select, type SelectProps } from '@lobehub/ui/base-ui';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { DEFAULT_AVATAR } from '@/const/meta';
import { messengerService } from '@/services/messenger';

interface AgentSelectProps extends Omit<SelectProps<string>, 'options' | 'value' | 'onChange'> {
  /**
   * When nothing is selected, auto-select the scope's inbox (LobeAI) agent once
   * the list resolves. Used when the user switches scope so the active agent
   * falls back to that scope's inbox instead of going empty.
   */
  defaultToInbox?: boolean;
  onChange?: (agentId: string | undefined) => void;
  value?: string;
  /** Scope to list agents for: a workspace id, or null/undefined for personal. */
  workspaceId?: string | null;
}

const AgentSelect = memo<AgentSelectProps>(
  ({ value, onChange, workspaceId, defaultToInbox, ...rest }) => {
    const { t: tCommon } = useTranslation('common');
    // Cascading fetch: agents are scoped to the selected `workspaceId` (or
    // personal when null). The scope is part of the SWR key so switching scope
    // refetches the right list.
    const agentsSWR = useSWR(['messenger:agentsForBinding', workspaceId ?? null], () =>
      messengerService.listAgentsForBinding(workspaceId),
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

    // Inbox (LobeAI) agent of the current scope, pinned to the top server-side.
    const inboxAgentId = useMemo(
      () => (agentsSWR.data ?? []).find((agent) => agent.isInbox)?.id,
      [agentsSWR.data],
    );

    // When asked to default to the scope's inbox and nothing is selected, select
    // it once the list resolves. Persists through the same onChange the dropdown
    // uses. Deps stay stable across the persist round-trip, so this fires once
    // per scope rather than looping.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    useEffect(() => {
      if (!defaultToInbox || value || !inboxAgentId) return;
      onChangeRef.current?.(inboxAgentId);
    }, [defaultToInbox, value, inboxAgentId]);

    return (
      <Select
        loading={agentsSWR.isLoading}
        options={options}
        value={value ?? null}
        onChange={(next) => onChange?.((next as string | null) ?? undefined)}
        {...rest}
      />
    );
  },
);

AgentSelect.displayName = 'MessengerAgentSelect';

export default AgentSelect;
