import type { GenericItemType } from '@lobehub/ui';

type TabContextMenuLabelKey =
  'tab.closeCurrentTab' | 'tab.closeLeftTabs' | 'tab.closeOtherTabs' | 'tab.closeRightTabs';

interface TabContextMenuParams {
  id: string;
  index: number;
  onClose: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseRight: (id: string) => void;
  t: (key: TabContextMenuLabelKey) => string;
  totalCount: number;
}

export const buildTabContextMenuItems = ({
  id,
  index,
  onClose,
  onCloseLeft,
  onCloseOthers,
  onCloseRight,
  t,
  totalCount,
}: TabContextMenuParams): GenericItemType[] => [
  {
    disabled: totalCount === 1,
    key: 'closeCurrentTab',
    label: t('tab.closeCurrentTab'),
    onClick: () => onClose(id),
  },
  {
    disabled: totalCount === 1,
    key: 'closeOtherTabs',
    label: t('tab.closeOtherTabs'),
    onClick: () => onCloseOthers(id),
  },
  { type: 'divider' },
  {
    disabled: index === 0,
    key: 'closeLeftTabs',
    label: t('tab.closeLeftTabs'),
    onClick: () => onCloseLeft(id),
  },
  {
    disabled: index === totalCount - 1,
    key: 'closeRightTabs',
    label: t('tab.closeRightTabs'),
    onClick: () => onCloseRight(id),
  },
];
