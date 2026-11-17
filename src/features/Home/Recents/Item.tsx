import type { RecentItem } from '@lobechat/types';
import { ActionIcon, cssVar, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { FileTextIcon, HashIcon, MoreHorizontalIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { getPlatformIcon } from '@/features/AgentChannel/const';
import TaskStatusIcon from '@/features/AgentTasks/features/TaskStatusIcon';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import NavItem from '@/features/NavPanel/components/NavItem';
import { usePrefetchAgent } from '@/hooks/usePrefetchAgent';
import { usePrefetchPage } from '@/hooks/usePrefetchPage';

import { useRecentItemDropdownMenu } from './useDropdownMenu';

/** Same density as the Favorites rows above. */
const ICON_SIZE = 14;

const TYPE_ICON_MAP: Partial<Record<'document' | 'task' | 'topic', typeof FileTextIcon>> = {
  document: FileTextIcon,
  topic: HashIcon,
};

const RecentListItem = memo<RecentItem>((item) => {
  const { title, type, agentId, id, metadata, status } = item;
  const { t } = useTranslation('common');
  const IconComponent = TYPE_ICON_MAP[type] || FileTextIcon;
  const prefetchAgent = usePrefetchAgent();
  const prefetchPage = usePrefetchPage();

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

  const { dropdownMenu } = useRecentItemDropdownMenu(item);

  return (
    <Flexbox style={{ position: 'relative' }}>
      <NavItem
        compact
        contextMenuItems={dropdownMenu}
        title={title}
        actions={
          <DropdownMenu items={dropdownMenu()}>
            <ActionIcon
              aria-label={t('more')}
              icon={MoreHorizontalIcon}
              size={'small'}
              style={{ flex: 'none' }}
            />
          </DropdownMenu>
        }
        icon={(() => {
          if (type === 'task') {
            // Same liveness signal as running topics: an executing task wears
            // the animated running mark, not the static status glyph.
            if (status === 'running') return <RunningGlyph size={ICON_SIZE} />;
            return <TaskStatusIcon size={ICON_SIZE} status={status ?? 'backlog'} />;
          }

          if (type === 'topic' && metadata?.bot?.platform) {
            const ProviderIcon = getPlatformIcon(metadata.bot.platform);
            if (ProviderIcon) {
              return <ProviderIcon color={cssVar.colorTextDescription} size={ICON_SIZE} />;
            }
          }
          return (
            <Icon
              icon={IconComponent}
              size={ICON_SIZE}
              style={{ color: cssVar.colorTextDescription }}
            />
          );
        })()}
        onMouseEnter={handleMouseEnter}
      />
    </Flexbox>
  );
});

export default RecentListItem;
