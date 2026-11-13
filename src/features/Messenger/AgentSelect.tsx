'use client';

import { agentDisplayName } from '@lobechat/types';
import { Flexbox, Select, type SelectProps, Text } from '@lobehub/ui';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { messengerActions, messengerSelectors, useMessengerStore } from '@/store/messenger';

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
    // personal when null), one replica entry per scope, so switching scope
    // reads the right list and a reload paints it from the local copy.
    const scopeId = workspaceId ?? null;
    const agentsSync = messengerActions.useFetchBindingAgents(scopeId);
    const agents = useMessengerStore(messengerSelectors.bindingAgents(scopeId));
    const isSettled = useMessengerStore(messengerSelectors.isBindingAgentsSettled(scopeId));
    const isConfirmed = useMessengerStore(messengerSelectors.isBindingAgentsConfirmed(scopeId));

    const defaultAgentTitle = tCommon('defaultSession');
    const options = useMemo(
      () =>
        (agents ?? []).map((agent) => {
          const title = agentDisplayName(agent, defaultAgentTitle);
          return {
            label: (
              <Flexbox horizontal align={'center'} gap={8}>
                <AgentAvatar
                  agentId={agent.id}
                  avatar={agent.avatar}
                  background={agent.backgroundColor ?? undefined}
                  name={title}
                  shape={'circle'}
                  size={20}
                />
                <Text ellipsis>{title}</Text>
              </Flexbox>
            ),
            title,
            value: agent.id,
          };
        }),
      [agents, defaultAgentTitle],
    );

    // Inbox (LobeAI) agent of the current scope, pinned to the top server-side.
    // Defaulting writes the pick to the server, so it waits for the server's
    // list rather than a restored copy that may be stale.
    const inboxAgentId = useMemo(
      () => (isConfirmed ? agents?.find((agent) => agent.isInbox)?.id : undefined),
      [agents, isConfirmed],
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
        loading={!isSettled && !agentsSync.error}
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
