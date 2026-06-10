import { AccordionItem, ActionIcon, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FolderClosedIcon, PlusIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { useCommitWorkingDirectory } from '@/features/ChatInput/ControlBar/useCommitWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import TopicItem from '../../List/Item';
import { type GroupItemComponentProps } from '../GroupedAccordion';

const PROJECT_GROUP_PREFIX = 'project:';

const GroupItem = memo<GroupItemComponentProps>(({ group, activeTopicId, activeThreadId }) => {
  const { t } = useTranslation('topic');
  const { id, title, children } = group;

  const workingDirectory = useMemo(
    () => (id.startsWith(PROJECT_GROUP_PREFIX) ? id.slice(PROJECT_GROUP_PREFIX.length) : undefined),
    [id],
  );

  const agentId = useAgentStore((s) => s.activeAgentId);
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId ?? ''));
  const { commitAgentDefault } = useCommitWorkingDirectory(agentId ?? '');

  const handleAddTopic = useCallback(async () => {
    if (!workingDirectory || !agentId) return;
    // Write the agent's per-device default so the new topic inherits this
    // directory at creation time — the same high-precedence slot the picker
    // uses, not the legacy per-agent fallback that gets shadowed by it.
    await commitAgentDefault(workingDirectory);
    useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
  }, [workingDirectory, agentId, commitAgentDefault]);

  // Web can add a topic in a directory too when the agent targets a bound
  // device — the write goes to `workingDirByDevice`, no Electron dependency.
  const isDeviceMode = agencyConfig?.executionTarget === 'device' && !!agencyConfig?.boundDeviceId;
  const canAddTopic = (isDesktop || isDeviceMode) && !!workingDirectory;

  return (
    <AccordionItem
      itemKey={id}
      paddingBlock={4}
      paddingInline={4}
      action={
        canAddTopic ? (
          <ActionIcon
            icon={PlusIcon}
            size={'small'}
            title={t('actions.addNewTopicInProject', { directory: title })}
            tooltipProps={{ placement: 'right' }}
            onClick={(e) => {
              e.stopPropagation();
              void handleAddTopic();
            }}
          />
        ) : undefined
      }
      title={
        <Flexbox horizontal align="center" gap={8} height={24} style={{ overflow: 'hidden' }}>
          <Center flex={'none'} height={24} width={28}>
            <Icon
              color={cssVar.colorTextTertiary}
              icon={FolderClosedIcon}
              size={{ size: 15, strokeWidth: 1.5 }}
            />
          </Center>
          <Text ellipsis fontSize={14} style={{ color: cssVar.colorTextSecondary, flex: 1 }}>
            {title}
          </Text>
        </Flexbox>
      }
    >
      <Flexbox gap={1} paddingBlock={1}>
        {children.map((topic) => (
          <TopicItem
            active={activeTopicId === topic.id}
            fav={topic.favorite}
            id={topic.id}
            key={topic.id}
            metadata={topic.metadata}
            status={topic.status}
            threadId={activeThreadId}
            title={topic.title}
          />
        ))}
      </Flexbox>
    </AccordionItem>
  );
});

export default GroupItem;
