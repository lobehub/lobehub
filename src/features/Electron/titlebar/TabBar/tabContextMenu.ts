import type { GenericItemType } from '@lobehub/ui';

type TabContextMenuLabelKey =
  | 'tab.closeCurrentTab'
  | 'tab.closeLeftTabs'
  | 'tab.closeOtherTabs'
  | 'tab.closeRightTabs'
  | 'tab.pin'
  | 'tab.unpin';

interface TabContextMenuParams {
  id: string;
  index: number;
  onClose: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseRight: (id: string) => void;
  onTogglePin: (id: string) => void;
  pinned: boolean;
  pinnedCount: number;
  t: (key: TabContextMenuLabelKey) => string;
  totalCount: number;
}

// The bulk closes spare pinned tabs, so each entry is offered only when it would still
// reach something. Pinned tabs occupy indices 0..pinnedCount-1, which is what lets the
// reachable counts fall out of the target's index alone.
export const buildTabContextMenuItems = ({
  id,
  index,
  onClose,
  onCloseLeft,
  onCloseOthers,
  onCloseRight,
  onTogglePin,
  pinned,
  pinnedCount,
  t,
  totalCount,
}: TabContextMenuParams): GenericItemType[] => {
  const closableLeft = Math.max(0, index - pinnedCount);
  const closableRight = Math.max(0, totalCount - Math.max(index + 1, pinnedCount));
  const closableOthers = totalCount - pinnedCount - (pinned ? 0 : 1);

  return [
    {
      key: 'togglePin',
      label: pinned ? t('tab.unpin') : t('tab.pin'),
      onClick: () => onTogglePin(id),
    },
    { type: 'divider' },
    {
      disabled: totalCount === 1,
      key: 'closeCurrentTab',
      label: t('tab.closeCurrentTab'),
      onClick: () => onClose(id),
    },
    {
      disabled: closableOthers <= 0,
      key: 'closeOtherTabs',
      label: t('tab.closeOtherTabs'),
      onClick: () => onCloseOthers(id),
    },
    { type: 'divider' },
    {
      disabled: closableLeft === 0,
      key: 'closeLeftTabs',
      label: t('tab.closeLeftTabs'),
      onClick: () => onCloseLeft(id),
    },
    {
      disabled: closableRight === 0,
      key: 'closeRightTabs',
      label: t('tab.closeRightTabs'),
      onClick: () => onCloseRight(id),
    },
  ];
};
