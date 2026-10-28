import { agentDisplayName } from '@lobechat/types';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import type { DeviceListResult } from '@/store/device/useDeviceList';

import type { ChannelAgentDraft } from './agentEnvironment';
import { EnvironmentIssue } from './EnvironmentFields';
import { useChannelAgentDraft } from './useChannelAgentDraft';
import type { ChannelAgentOption } from './useChannelAgentOptions';

const styles = stylex.create({
  extra: { paddingInlineStart: 44, paddingInlineEnd: 8, paddingBlockEnd: 8, minWidth: 0 },
});

/** Channel options for a chosen Agent: inherit its own device and directory, never pick here. */
const INHERITED = { directoryOptional: true };

/**
 * A chosen Agent keeps its own device and directory without showing them: nothing here can
 * change them, so only what blocks creation appears. Per-channel changes happen after
 * creation, from the member list.
 */
export const SelectedAgent = ({
  agent,
  devices,
  draft: input,
  setDrafts,
}: {
  agent?: ChannelAgentOption;
  devices: DeviceListResult;
  draft: ChannelAgentDraft;
  setDrafts: Dispatch<SetStateAction<ChannelAgentDraft[]>>;
}) => {
  const { t } = useTranslation(['channel', 'chat']);
  const controls = useChannelAgentDraft(input, devices, setDrafts, INHERITED);
  const { draft } = controls;
  const name = agentDisplayName(agent, t('unnamedAgent'));

  return (
    <Flexbox gap={4}>
      <Flexbox horizontal align="center" gap={8} padding={8}>
        <AgentAvatar
          agentId={input.agentId}
          avatar={typeof agent?.avatar === 'string' ? agent.avatar : undefined}
          background={agent?.backgroundColor ?? undefined}
          name={name}
          shape={'circle'}
          size={28}
        />
        <Text ellipsis style={{ flex: 1 }}>
          {name}
        </Text>
        <ActionIcon
          aria-label={t('group.removeMember', { ns: 'chat' })}
          icon={X}
          size="small"
          title={t('group.removeMember', { ns: 'chat' })}
          onClick={() =>
            setDrafts((current) => current.filter((item) => item.agentId !== draft.agentId))
          }
        />
      </Flexbox>
      {draft.issue && (
        <Flexbox gap={8} {...stylex.props(styles.extra)}>
          <EnvironmentIssue inherited controls={controls} />
        </Flexbox>
      )}
    </Flexbox>
  );
};
