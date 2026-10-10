'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
  Center,
  createStaticStyles,
  cssVar,
  Flexbox,
  Text,
} from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import TopicItem from '../../List/Item';
import { type GroupItemComponentProps } from '../GroupedAccordion';

const AGENT_GROUP_PREFIX = 'agent:';

const styles = createStaticStyles(({ css }) => ({
  avatarWrap: css`
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
  const { id, title, children } = group;
  const agentId = id.startsWith(AGENT_GROUP_PREFIX)
    ? id.slice(AGENT_GROUP_PREFIX.length)
    : undefined;

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

  const avatar =
    row?.agentAvatar || registeredMeta?.avatar || (isOwnBucket ? activeMeta.avatar : undefined);
  const name =
    title ??
    registeredMeta?.title ??
    registeredMeta?.name ??
    (isOwnBucket ? (activeMeta.title ?? activeMeta.name) : undefined) ??
    t('groupTitle.byAgent.unknown');

  return (
    <AccordionItem value={id}>
      <AccordionHeader>
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
          <Flexbox horizontal align="center" gap={8} height={24} style={{ overflow: 'hidden' }}>
            <Center className={styles.avatarWrap} flex={'none'} height={18} width={18}>
              <Avatar avatar={avatar} name={name} size={18} />
            </Center>
            <Text ellipsis fontSize={14} style={{ flex: 1 }}>
              {name}
            </Text>
          </Flexbox>
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        <Flexbox gap={1} paddingBlock={1}>
          {children.map((topic) => (
            <TopicItem
              // The group header already names the owning agent — the row
              // must not repeat the avatar at its leading position.
              showWorkingDirectory
              suppressAgentAvatar
              fav={topic.favorite}
              id={topic.id}
              key={topic.id}
              metadata={topic.metadata}
              runStartedAt={topic.runStartedAt}
              status={topic.status}
              title={topic.title}
              userId={topic.userId}
            />
          ))}
        </Flexbox>
      </AccordionPanel>
    </AccordionItem>
  );
}, isEqual);

GroupItem.displayName = 'TopicByAgentGroupItem';

export default GroupItem;
