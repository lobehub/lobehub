import { agentDisplayName } from '@lobechat/types';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import type { DeviceListResult } from '@/store/device/useDeviceList';

import type { ChannelAgentDraft } from './agentEnvironment';
import {
  EnvironmentFields,
  EnvironmentIssue,
  environmentSummary,
  needsEnvironmentInput,
} from './EnvironmentFields';
import { useChannelAgentDraft } from './useChannelAgentDraft';
import type { ChannelAgentOption } from './useChannelAgentOptions';

const styles = stylex.create({
  extra: { paddingInlineStart: 44, paddingInlineEnd: 8, paddingBlockEnd: 8, minWidth: 0 },
});

/**
 * A chosen Agent keeps its own device and directory, shown as one line. Fields appear only
 * when the Agent cannot run without a choice; per-channel changes happen after creation.
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
  const controls = useChannelAgentDraft(input, devices, setDrafts);
  const { draft } = controls;
  // Once the user starts fixing the environment, keep the fields until the row is removed.
  const [editing, setEditing] = useState(false);
  const name = agentDisplayName(agent, t('unnamedAgent'));
  const showFields = draft.initialized && (editing || needsEnvironmentInput(draft.issue));
  const summary = !showFields && !draft.issue ? environmentSummary(draft, devices) : undefined;

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
      {(showFields || summary || draft.issue) && (
        <Flexbox gap={8} {...stylex.props(styles.extra)}>
          {summary && (
            <Text ellipsis fontSize={12} title={summary} type="secondary">
              {summary}
            </Text>
          )}
          {showFields && (
            <EnvironmentFields
              devices={devices}
              name={name}
              controls={{
                ...controls,
                change: (patch) => {
                  setEditing(true);
                  controls.change(patch);
                },
                changeDevice: (deviceId) => {
                  setEditing(true);
                  controls.changeDevice(deviceId);
                },
              }}
            />
          )}
          <EnvironmentIssue controls={controls} />
        </Flexbox>
      )}
    </Flexbox>
  );
};
