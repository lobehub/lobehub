'use client';

import { agentDisplayName } from '@lobechat/types';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  Center,
  createStaticStyles,
  cssVar,
  cx,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Tag,
  Text,
} from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ListFilter, LucideCheck, PlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import { canStageDraftOn } from '@/features/Projects/WorkingDirectories/startProjectTopicDraft';
import { useAgentFixedDeviceId } from '@/features/Projects/WorkingDirectories/useAgentFixedDeviceId';
import { useStartProjectTopic } from '@/features/Projects/WorkingDirectories/useStartProjectTopic';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { type ProjectTopicSubGroupMode } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useProjectDirectories } from '@/store/projectWorkingDirectory';

import { useTopicListScope } from '../../TopicListScope';
import ProjectTopicList from '../ByProjectMode/ProjectTopicList';
import { type GroupItemComponentProps } from '../GroupedAccordion';
import DevicePresenceDot from './DevicePresenceDot';

const AGENT_GROUP_PREFIX = 'agent:';
const SUB_GROUP_MODES: ProjectTopicSubGroupMode[] = ['none', 'byDevice', 'byTime', 'byStatus'];

const styles = createStaticStyles(({ css }) => ({
  avatarWrap: css`
    position: relative;
    flex: none;
    border-radius: 50%;
    background: ${cssVar.colorFillTertiary};
  `,
}));

/**
 * Agent attribution only exists on feeds that join it in (the project topic
 * list selects agent columns per row); per-agent sidebar buckets omit it, so
 * those rows flow into the `no-agent` bucket and resolve to the active agent.
 */
interface AgentAttributedRow {
  agentAvatar?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  agentTitle?: string | null;
}

const GroupItem = memo<GroupItemComponentProps>(({ group }) => {
  const { t } = useTranslation('topic');
  const { t: tProject } = useTranslation('project');
  const { id, title, children } = group;
  const agentId = id.startsWith(AGENT_GROUP_PREFIX)
    ? id.slice(AGENT_GROUP_PREFIX.length)
    : undefined;

  const scope = useTopicListScope();
  const directories = useProjectDirectories(scope?.projectId);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const activeMeta = useAgentStore(agentSelectors.currentAgentMeta);
  const registeredMeta = useAgentStore((s) =>
    agentId ? agentSelectors.getAgentMetaById(agentId)(s) : undefined,
  );

  const row = children[0] as AgentAttributedRow | undefined;
  // The unattributed bucket — or a bucket of the currently open agent — speaks
  // for the agent context the list already has; any other bucket must resolve
  // from its own rows or the agent registry to avoid mislabeling.
  const isOwnBucket = !agentId || agentId === activeAgentId;

  const isCoordinator = !!agentId && agentId === scope?.coordinatorAgentId;
  // An empty main-agent group has no row to read; the project knows its main agent.
  const coordinatorMeta = isCoordinator ? scope?.coordinatorAgent : undefined;

  const avatar =
    row?.agentAvatar ||
    registeredMeta?.avatar ||
    coordinatorMeta?.avatar ||
    (isOwnBucket ? activeMeta.avatar : undefined);
  const name =
    title ??
    agentDisplayName(registeredMeta) ??
    (isOwnBucket ? agentDisplayName(activeMeta) : undefined) ??
    t('groupTitle.byAgent.unknown');

  // Only an attributed bucket in a project-scoped list can start a topic with
  // its agent preselected; the `no-agent` bucket has no agent to preselect.
  const canAddTopic = !!scope && !!agentId;
  // A directory that can't run work — or one on another device than the agent
  // is fixed to — would stage a draft whose first send is refused, so both the
  // default and the device sections' "+" only consider ones the agent can use.
  const fixedDeviceId = useAgentFixedDeviceId(agentId);
  const startDirectories = useMemo(
    () => (canAddTopic ? directories.filter((d) => canStageDraftOn(d, fixedDeviceId)) : undefined),
    [canAddTopic, directories, fixedDeviceId],
  );

  const startTopic = useStartProjectTopic(scope?.projectId);
  // Same habit as an agent's "+": straight into this agent's conversation, on
  // the first directory it can run in when there is one.
  const handleAddTopic = (initialDirectoryId?: string) => {
    if (!scope || !agentId) return;
    startTopic({ agentId, directoryId: initialDirectoryId ?? startDirectories?.[0]?.id });
  };

  // The agent bucket already sits inside one project, so its rows skip the
  // directory line; a second-level split (device / time / status) is what
  // tells the topics apart. Same per-group preference as the project rows.
  const storedSubGroupMode = useGlobalStore(systemStatusSelectors.projectTopicSubGroupMode(id));
  const subGroupMode = SUB_GROUP_MODES.includes(storedSubGroupMode) ? storedSubGroupMode : 'none';
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const subGroupMenuItems = useMemo<DropdownItem[]>(
    () => [
      {
        children: SUB_GROUP_MODES.map((mode) => ({
          icon: subGroupMode === mode ? <Icon icon={LucideCheck} /> : <div />,
          key: `sub-group-${mode}`,
          label: tProject(`topics.subGroup.${mode}`),
          onClick: () => updateSystemStatus({ projectTopicSubGroupModeByGroup: { [id]: mode } }),
        })),
        key: 'sub-group',
        label: tProject('topics.subGroup.title'),
        type: 'group',
      },
    ],
    [id, subGroupMode, tProject, updateSystemStatus],
  );

  return (
    <AccordionItem value={id}>
      <AccordionHeader>
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
          <Flexbox horizontal align="center" gap={8} height={24} style={{ overflow: 'hidden' }}>
            <Center className={styles.avatarWrap} flex={'none'} height={18} width={18}>
              <AgentAvatar
                agentId={agentId ?? (isOwnBucket ? activeAgentId : undefined)}
                avatar={avatar}
                name={name}
                shape={'circle'}
                size={18}
              />
              {agentId && <DevicePresenceDot agentId={agentId} />}
            </Center>
            <Text ellipsis fontSize={14} style={{ flex: 1 }}>
              {name}
            </Text>
            {isCoordinator && (
              <Tag color={'primary'} size={'small'}>
                {tProject('sidebar.coordinatorTag')}
              </Tag>
            )}
          </Flexbox>
        </AccordionTrigger>
        <div
          className={cx(
            'accordion-action',
            accordionStyles.action,
            accordionStyles.actionBorderless,
          )}
        >
          <Flexbox horizontal align={'center'} gap={4}>
            <DropdownMenu items={subGroupMenuItems}>
              <ActionIcon
                icon={ListFilter}
                size={'small'}
                title={tProject('topics.subGroup.title')}
                onClick={(e) => e.stopPropagation()}
              />
            </DropdownMenu>
            {canAddTopic && (
              <ActionIcon
                icon={PlusIcon}
                size={'small'}
                title={tProject('sidebar.newConversation')}
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddTopic();
                }}
              />
            )}
          </Flexbox>
        </div>
      </AccordionHeader>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        {!children.length && canAddTopic && (
          <EmptyNavItem
            title={tProject('sidebar.newConversation')}
            onClick={() => handleAddTopic()}
          />
        )}
        <ProjectTopicList
          // The group header already names the owning agent — the row must not
          // repeat the avatar at its leading position.
          suppressAgentAvatar
          mode={subGroupMode}
          startAgentId={agentId}
          startDirectories={startDirectories}
          topics={children}
          onStartInDirectory={canAddTopic ? handleAddTopic : undefined}
        />
      </AccordionPanel>
    </AccordionItem>
  );
}, isEqual);

GroupItem.displayName = 'TopicByAgentGroupItem';

export default GroupItem;
