'use client';

import { copyToClipboard } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { MoreHorizontal } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildPortalMoreMenuItems } from './buildItems';
import { type PortalMoreMenuConfig } from './types';

interface PortalMoreMenuProps {
  config?: PortalMoreMenuConfig;
}

/**
 * The one `…` every portal header shows right after its title. Portals never
 * render it themselves — they declare capabilities on `PortalImpl.useMoreMenu`
 * and the shared header mounts this menu in its title slot.
 */
const PortalMoreMenu = memo<PortalMoreMenuProps>(({ config }) => {
  const { t } = useTranslation('portal');

  const items = useMemo(
    () =>
      buildPortalMoreMenuItems(config, {
        copy: async (value, successKey) => {
          await copyToClipboard(value);
          toast.success(t(successKey));
        },
        t: (key) => t(key),
      }),
    [config, t],
  );

  if (items.length === 0) return null;

  return (
    <DropdownMenu
      iconSpaceMode={'group'}
      items={items}
      placement={'bottomLeft'}
      popupProps={{ style: { minWidth: 180 } }}
    >
      <ActionIcon
        aria-label={t('moreMenu.trigger')}
        icon={MoreHorizontal}
        size={'small'}
        style={{ flex: 'none' }}
        title={t('moreMenu.trigger')}
      />
    </DropdownMenu>
  );
});

PortalMoreMenu.displayName = 'PortalMoreMenu';

export default PortalMoreMenu;
