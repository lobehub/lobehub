import {
  ActionIcon,
  Block,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { Check, ChevronDownIcon, ChevronUpIcon, MoreHorizontal, Trash } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BriefCardActions from '@/features/DailyBrief/BriefCardActions';
import BriefCardSummary from '@/features/DailyBrief/BriefCardSummary';
import BriefIcon from '@/features/DailyBrief/BriefIcon';
import { styles as briefStyles } from '@/features/DailyBrief/style';
import type { BriefItem } from '@/features/DailyBrief/types';
import Time from '@/routes/(main)/home/features/components/Time';
import { useBriefStore } from '@/store/brief';

interface TaskBriefCardProps {
  brief: BriefItem;
  onAfterAddComment?: () => void | Promise<void>;
  onAfterDelete?: () => void | Promise<void>;
  onAfterResolve?: () => void | Promise<void>;
}

const TaskBriefCard = memo<TaskBriefCardProps>(
  ({ brief, onAfterResolve, onAfterAddComment, onAfterDelete }) => {
    const { t } = useTranslation('home');
    const { modal } = App.useApp();
    const deleteBrief = useBriefStore((s) => s.deleteBrief);
    const isResolved = Boolean(brief.resolvedAction);
    const [expanded, setExpanded] = useState(false);
    const showFull = !isResolved || expanded;

    const handleDelete = useCallback(() => {
      modal.confirm({
        centered: true,
        content: t('brief.deleteConfirm.content'),
        okButtonProps: { danger: true },
        okText: t('brief.deleteConfirm.ok'),
        onOk: async () => {
          await deleteBrief(brief.id);
          await onAfterDelete?.();
        },
        title: t('brief.deleteConfirm.title'),
        type: 'error',
      });
    }, [brief.id, deleteBrief, modal, onAfterDelete, t]);

    const menuItems = useMemo<DropdownItem[]>(
      () => [
        {
          danger: true,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('brief.delete'),
          onClick: handleDelete,
        },
      ],
      [handleDelete, t],
    );

    return (
      <Block
        className={briefStyles.card}
        gap={12}
        paddingBlock={12}
        paddingInline={8}
        style={{ borderRadius: cssVar.borderRadiusLG }}
        variant={'outlined'}
      >
        <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
          <BriefIcon muted={isResolved} size={24} type={brief.type} />
          <Text ellipsis style={{ flex: 1 }} weight={500}>
            {brief.title}
          </Text>
          {isResolved && !expanded && (
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon color={cssVar.colorTextQuaternary} icon={Check} size={14} />
              <Text className={briefStyles.resolvedTag}>{t('brief.resolved')}</Text>
            </Flexbox>
          )}
          <Time date={brief.createdAt} />
          {isResolved && (
            <ActionIcon
              icon={expanded ? ChevronUpIcon : ChevronDownIcon}
              size={'small'}
              title={expanded ? t('brief.collapse') : t('brief.expandAll')}
              onClick={() => setExpanded((v) => !v)}
            />
          )}
          <DropdownMenu items={menuItems}>
            <ActionIcon icon={MoreHorizontal} size={'small'} />
          </DropdownMenu>
        </Flexbox>
        {showFull && (
          <>
            <BriefCardSummary summary={brief.summary} />
            <BriefCardActions
              actions={brief.actions}
              briefId={brief.id}
              briefType={brief.type}
              resolvedAction={brief.resolvedAction}
              taskId={brief.taskId}
              onAfterAddComment={onAfterAddComment}
              onAfterResolve={onAfterResolve}
            />
          </>
        )}
      </Block>
    );
  },
);

export default TaskBriefCard;
