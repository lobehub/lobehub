import { Icon } from '@lobehub/ui';
import { type DropdownItem } from '@lobehub/ui/base-ui';
import { Copy, FileText, Link, Maximize2, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { createElement } from 'react';

import { type PortalMoreMenuConfig } from './types';

export type PortalMoreMenuLabelKey =
  | 'moreMenu.copyId'
  | 'moreMenu.copyIdSuccess'
  | 'moreMenu.copyLink'
  | 'moreMenu.copyLinkSuccess'
  | 'moreMenu.copyPath'
  | 'moreMenu.copyPathSuccess'
  | 'moreMenu.delete'
  | 'moreMenu.openInPage'
  | 'moreMenu.refresh'
  | 'moreMenu.rename';

interface BuildOptions {
  copy: (value: string, successKey: PortalMoreMenuLabelKey) => void;
  t: (key: PortalMoreMenuLabelKey) => string;
}

/**
 * Maps declared capabilities to menu items in the one fixed order every
 * portal shares:
 *
 *   rename | copy link, copy id, copy path, open in page, refresh | extra items | delete
 *
 * Groups with nothing declared vanish together with their divider.
 */
export const buildPortalMoreMenuItems = (
  config: PortalMoreMenuConfig | undefined,
  { copy, t }: BuildOptions,
): DropdownItem[] => {
  if (!config) return [];

  const edit: DropdownItem[] = [];
  if (config.rename)
    edit.push({
      icon: createElement(Icon, { icon: Pencil }),
      key: 'rename',
      label: t('moreMenu.rename'),
      onClick: config.rename,
    });

  const share: DropdownItem[] = [];
  const { copyId, copyLink, copyPath } = config;
  if (copyLink)
    share.push({
      icon: createElement(Icon, { icon: Link }),
      key: 'copyLink',
      label: t('moreMenu.copyLink'),
      onClick: () => copy(copyLink, 'moreMenu.copyLinkSuccess'),
    });
  if (copyId)
    share.push({
      icon: createElement(Icon, { icon: Copy }),
      key: 'copyId',
      label: t('moreMenu.copyId'),
      onClick: () => copy(copyId, 'moreMenu.copyIdSuccess'),
    });
  if (copyPath)
    share.push({
      icon: createElement(Icon, { icon: FileText }),
      key: 'copyPath',
      label: t('moreMenu.copyPath'),
      onClick: () => copy(copyPath, 'moreMenu.copyPathSuccess'),
    });
  if (config.openInPage)
    share.push({
      icon: createElement(Icon, { icon: Maximize2 }),
      key: 'openInPage',
      label: t('moreMenu.openInPage'),
      onClick: config.openInPage,
    });
  const { refresh } = config;
  if (refresh)
    share.push({
      icon: createElement(Icon, { icon: RotateCw }),
      key: 'refresh',
      label: t('moreMenu.refresh'),
      onClick: () => void refresh(),
    });

  const danger: DropdownItem[] = [];
  if (config.delete)
    danger.push({
      danger: true,
      icon: createElement(Icon, { icon: Trash2 }),
      key: 'delete',
      label: t('moreMenu.delete'),
      onClick: config.delete,
    });

  const groups = [edit, share, config.extraItems ?? [], danger].filter((group) => group.length);

  return groups.flatMap((group, index) =>
    index === 0 ? group : [{ key: `divider-${index}`, type: 'divider' } as DropdownItem, ...group],
  );
};
