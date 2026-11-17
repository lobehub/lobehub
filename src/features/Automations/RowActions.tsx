'use client';

import type { InboundWebhookItem } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Tooltip,
} from '@lobehub/ui';
import { MoreHorizontalIcon, PencilIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type AutomationRowCallbacks, useAutomationRowActions } from './useAutomationRowActions';

interface RowActionsProps extends AutomationRowCallbacks {
  item: InboundWebhookItem;
}

/**
 * Check, then a menu with rename (the creator's) and delete. Both act with the connector's credentials or on someone's
 * automation, so both follow `canManage`; a row the viewer cannot manage keeps
 * the buttons, disabled, with the reason on hover.
 */
const RowActions = memo<RowActionsProps>(({ item, onChecked, onRemoved }) => {
  const { t } = useTranslation('setting');
  const { canRename, check, checking, confirmDelete, rename } = useAutomationRowActions(item, {
    onChecked,
    onRemoved,
  });

  const noPermission = item.canManage ? undefined : t('automations.actions.noPermission');

  // Rename is its creator's; delete is anyone's who manages it. A row the viewer cannot manage
  // keeps the menu with delete disabled; the Check button's hover says why.
  const menu: DropdownItem[] = [
    ...(canRename
      ? ([
          {
            icon: <Icon icon={PencilIcon} />,
            key: 'rename',
            label: t('automations.actions.rename'),
            onClick: rename,
          },
          { type: 'divider' },
        ] satisfies DropdownItem[])
      : []),
    {
      danger: true,
      disabled: !item.canManage,
      icon: <Icon icon={Trash2Icon} />,
      key: 'delete',
      label: t('automations.actions.delete'),
      onClick: confirmDelete,
    },
  ];

  return (
    // Clicks stay here: in the narrow layout the row is a card the user may tap.
    <Flexbox horizontal align={'center'} gap={4} onClick={(event) => event.stopPropagation()}>
      {item.canCheck && (
        <Tooltip title={noPermission ?? t('automations.actions.checkTooltip')}>
          <Button
            disabled={!item.canManage}
            icon={<Icon icon={RefreshCwIcon} />}
            loading={checking}
            size={'small'}
            onClick={check}
          >
            {t('automations.actions.check')}
          </Button>
        </Tooltip>
      )}
      <DropdownMenu items={menu} placement={'bottomRight'}>
        <ActionIcon
          // The tooltip is not an accessible name; screen readers need one.
          aria-label={t('automations.actions.more')}
          icon={MoreHorizontalIcon}
          size={'small'}
          title={t('automations.actions.more')}
        />
      </DropdownMenu>
    </Flexbox>
  );
});

RowActions.displayName = 'AutomationRowActions';

export default RowActions;
