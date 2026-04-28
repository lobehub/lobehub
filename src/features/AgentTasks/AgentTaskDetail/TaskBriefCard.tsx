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
import { MoreHorizontal, Trash } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
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
          <BriefIcon size={24} type={brief.type} />
          <Text ellipsis style={{ flex: 1 }} weight={500}>
            {brief.title}
          </Text>
          <Time date={brief.createdAt} />
          <DropdownMenu items={menuItems}>
            <ActionIcon icon={MoreHorizontal} size={'small'} />
          </DropdownMenu>
        </Flexbox>
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
      </Block>
    );
  },
);

export default TaskBriefCard;
