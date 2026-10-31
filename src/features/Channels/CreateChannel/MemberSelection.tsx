import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';
import { agentDisplayName } from '@lobechat/types';
import { Checkbox, Flexbox, SearchBar, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import AgentSelectionEmpty from '@/features/AgentSelectionEmpty';
import { useDeviceList } from '@/store/device/useDeviceList';

import type { ChannelAgentDraft } from './agentEnvironment';
import type { PeopleSelection } from './PeopleOptions';
import { PeopleOptions, SelectedPerson } from './PeopleOptions';
import { pickerStyles as styles } from './pickerStyles';
import { splitByPriority } from './projectAgentOrder';
import { SelectedAgent } from './SelectedAgent';
import type { ChannelAgentOption, useChannelAgentOptions } from './useChannelAgentOptions';

/** Name plus the external runtime, which is why a coding Agent asks for a device. */
const AgentLabel = ({ agent, fallback }: { agent?: ChannelAgentOption; fallback: string }) => (
  <Flexbox horizontal align="center" flex={1} gap={6} style={{ minWidth: 0 }}>
    <Text ellipsis>{agentDisplayName(agent, fallback)}</Text>
    {agent?.runtime && (
      <Tag size="small" style={{ flex: 'none' }}>
        {getHeterogeneousTypeLabel(agent.runtime)}
      </Tag>
    )}
  </Flexbox>
);

const SectionTitle = ({ children }: { children: string }) => (
  <Text fontSize={12} type="secondary" weight={500} {...stylex.props(styles.section)}>
    {children}
  </Text>
);

const AgentOptionRow = ({
  agent,
  checked,
  fallback,
  onToggle,
}: {
  agent: ChannelAgentOption;
  checked: boolean;
  fallback: string;
  onToggle: () => void;
}) => (
  <label {...stylex.props(styles.row)}>
    <Checkbox checked={checked} onChange={onToggle} />
    <AgentAvatar
      agentId={agent.id}
      avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
      background={agent.backgroundColor ?? undefined}
      name={agentDisplayName(agent, fallback)}
      shape={'circle'}
      size={28}
    />
    <AgentLabel agent={agent} fallback={fallback} />
  </label>
);

/**
 * Searchable candidates on the left, chosen members on the right. Workspace Channels also
 * offer people, so inviting anyone happens in one place with one search.
 */
export const MemberSelection = ({
  exclude = [],
  options,
  people,
  value,
  onChange,
}: {
  /** Agents already in the Channel. */
  exclude?: string[];
  onChange: Dispatch<SetStateAction<ChannelAgentDraft[]>>;
  options: ReturnType<typeof useChannelAgentOptions>;
  people?: PeopleSelection;
  value: ChannelAgentDraft[];
}) => {
  const { t } = useTranslation(['channel', 'device', 'chat', 'common']);
  const { agents, projectAgentIds = [] } = options;
  const [search, setSearch] = useState('');
  const available = (agents ?? []).filter((agent) => !exclude.includes(agent.id));
  const filtered = available.filter((agent) =>
    `${agentDisplayName(agent, t('unnamedAgent'))} ${agent.description ?? ''}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  // Inside a project its own team comes first, so a project Channel starts from the project.
  const { others, priority } = splitByPriority(filtered, projectAgentIds);
  const toggle = (agentId: string) =>
    onChange((current) =>
      current.some((item) => item.agentId === agentId)
        ? current.filter((item) => item.agentId !== agentId)
        : [...current, { agentId, initialized: false, issue: 'configurationLoading' }],
    );
  const renderAgent = (agent: ChannelAgentOption) => (
    <AgentOptionRow
      agent={agent}
      checked={value.some((item) => item.agentId === agent.id)}
      fallback={t('unnamedAgent')}
      key={agent.id}
      onToggle={() => toggle(agent.id)}
    />
  );
  const devices = useDeviceList({ refreshInterval: 15_000 });
  const selectedCount = value.length + (people?.value.length ?? 0);

  return (
    <Flexbox gap={12}>
      <AsyncBoundary
        data={agents}
        error={options.error}
        isLoading={!agents && !options.error}
        onRetry={options.retry}
      >
        <div {...stylex.props(styles.picker)}>
          <Flexbox gap={8} {...stylex.props(styles.pane)}>
            <SearchBar
              allowClear
              autoFocus
              placeholder={t(people ? 'invite.search' : 'searchAgents')}
              value={search}
              variant="filled"
              onChange={(event) => setSearch(event.target.value)}
            />
            <Flexbox gap={people || priority.length ? 8 : 0} {...stylex.props(styles.pane)}>
              {people && <PeopleOptions people={people} search={search} />}
              {priority.length > 0 && (
                <Flexbox gap={2}>
                  <SectionTitle>{t('projectAgents')}</SectionTitle>
                  {priority.map(renderAgent)}
                </Flexbox>
              )}
              <Flexbox gap={2}>
                {(people || (priority.length > 0 && others.length > 0)) && (
                  <SectionTitle>{t(priority.length ? 'otherAgents' : 'agents')}</SectionTitle>
                )}
                {others.length ? (
                  others.map(renderAgent)
                ) : priority.length ? null : people ? (
                  <Text fontSize={12} type="secondary" {...stylex.props(styles.section)}>
                    {t(search.trim() ? 'invite.noAgentMatches' : 'invite.noAgents')}
                  </Text>
                ) : (
                  <AgentSelectionEmpty search={!!search.trim()} variant="noAvailable" />
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
          <Flexbox gap={8} {...stylex.props(styles.pane, styles.selected)}>
            <Text fontSize={12} type="secondary">
              {t('memberSelection.selectedAgents', { ns: 'chat', count: selectedCount })}
            </Text>
            {!selectedCount &&
              (people ? (
                <Text fontSize={12} type="secondary" {...stylex.props(styles.section)}>
                  {t('invite.noSelected')}
                </Text>
              ) : (
                <AgentSelectionEmpty variant="noSelected" />
              ))}
            {people?.value.map((person) => (
              <SelectedPerson
                key={person.userId}
                person={person}
                onRemove={() =>
                  people.onChange((current) =>
                    current.filter((item) => item.userId !== person.userId),
                  )
                }
              />
            ))}
            {!!devices.error && (
              <AsyncError
                error={devices.error}
                retrying={devices.isValidating}
                title={t('environment.devicesFailed')}
                variant="inline"
                onRetry={() => void devices.mutate()}
              />
            )}
            {value.map((draft) => (
              <SelectedAgent
                agent={agents?.find((agent) => agent.id === draft.agentId)}
                devices={devices}
                draft={draft}
                key={draft.agentId}
                setDrafts={onChange}
              />
            ))}
          </Flexbox>
        </div>
      </AsyncBoundary>
    </Flexbox>
  );
};
