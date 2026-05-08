import { ActionIcon, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FileTextIcon, HashIcon, MoreHorizontalIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import InlineRename from '@/components/InlineRename';
import TaskStatusIcon from '@/features/AgentTasks/features/TaskStatusIcon';
import NavItem from '@/features/NavPanel/components/NavItem';
import { usePrefetchAgent } from '@/hooks/usePrefetchAgent';
import { usePrefetchPage } from '@/hooks/usePrefetchPage';
import { getPlatformIcon } from '@/routes/(main)/agent/channel/const';
import { type RecentItem } from '@/server/routers/lambda/recent';
import { useTaskStore } from '@/store/task';

import { useRecentItemDropdownMenu } from './useDropdownMenu';

const TYPE_ICON_MAP: Partial<Record<'document' | 'task' | 'topic', typeof FileTextIcon>> = {
  document: FileTextIcon,
  topic: HashIcon,
};

type TaskStatus = 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running';
const LEGACY_TASK_STATUS_MAP: Record<string, TaskStatus> = {
  backlog: 'backlog',
  canceled: 'canceled',
  completed: 'completed',
  failed: 'failed',
  in_progress: 'running',
  paused: 'paused',
  running: 'running',
  todo: 'backlog',
};
const normalizeTaskStatus = (status?: string | null): TaskStatus => {
  if (!status) return 'backlog';
  return LEGACY_TASK_STATUS_MAP[status] ?? 'backlog';
};

const RecentListItem = memo<RecentItem>((item) => {
  const { title, type, agentId, id, metadata, status } = item;
  const IconComponent = TYPE_ICON_MAP[type] || FileTextIcon;
  const [editing, setEditing] = useState(false);
  const prefetchAgent = usePrefetchAgent();
  const prefetchPage = usePrefetchPage();
  const taskKey = type === 'task' ? id : undefined;
  // Prefer the live task store entry (kept fresh by detail-page mutations) over
  // the recent.getAll snapshot, so returning from the detail page reflects the
  // latest status without waiting for the next poll.
  const liveTaskStatus = useTaskStore((s) =>
    taskKey ? s.taskDetailMap[taskKey]?.status : undefined,
  );
  const taskStatus = liveTaskStatus ?? status;

  const toggleEditing = useCallback((visible?: boolean) => {
    setEditing(!!visible);
  }, []);

  const handleMouseEnter = useCallback(() => {
    switch (type) {
      case 'topic':
      case 'task': {
        if (agentId) prefetchAgent(agentId);
        break;
      }
      case 'document': {
        prefetchPage(id);
        break;
      }
    }
  }, [type, agentId, id, prefetchAgent, prefetchPage]);

  const { dropdownMenu, handleRename } = useRecentItemDropdownMenu(item, toggleEditing);

  return (
    <Flexbox style={{ position: 'relative' }}>
      <NavItem
        contextMenuItems={dropdownMenu}
        disabled={editing}
        title={title}
        actions={
          <DropdownMenu items={dropdownMenu()} nativeButton={false}>
            <ActionIcon icon={MoreHorizontalIcon} size={'small'} style={{ flex: 'none' }} />
          </DropdownMenu>
        }
        icon={(() => {
          if (type === 'task') {
            return <TaskStatusIcon size={16} status={normalizeTaskStatus(taskStatus)} />;
          }

          if (type === 'topic' && metadata?.bot?.platform) {
            const ProviderIcon = getPlatformIcon(metadata.bot.platform);
            if (ProviderIcon) {
              return <ProviderIcon color={cssVar.colorTextDescription} size={16} />;
            }
          }
          return (
            <Icon
              icon={IconComponent}
              size={'small'}
              style={{ color: cssVar.colorTextDescription }}
            />
          );
        })()}
        onMouseEnter={handleMouseEnter}
      />
      <InlineRename
        open={editing}
        title={title}
        onOpenChange={(open) => toggleEditing(open)}
        onSave={handleRename}
      />
    </Flexbox>
  );
});

export default RecentListItem;
