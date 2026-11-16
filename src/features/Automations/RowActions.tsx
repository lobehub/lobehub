'use client';

import type { InboundWebhookItem } from '@lobechat/types';
import { ActionIcon, Button, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type AutomationRowCallbacks, useAutomationRowActions } from './useAutomationRowActions';

interface RowActionsProps extends AutomationRowCallbacks {
  item: InboundWebhookItem;
}

/**
 * Check and delete. Both act with the connector's credentials or on someone's
 * automation, so both follow `canManage`; a row the viewer cannot manage keeps
 * the buttons, disabled, with the reason on hover.
 */
const RowActions = memo<RowActionsProps>(({ item, onChecked, onRemoved }) => {
  const { t } = useTranslation('setting');
  const { check, checking, confirmDelete } = useAutomationRowActions(item, {
    onChecked,
    onRemoved,
  });

  const noPermission = item.canManage ? undefined : t('automations.actions.noPermission');

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
      <ActionIcon
        // The tooltip is not an accessible name; screen readers need one.
        aria-label={t('automations.actions.delete')}
        disabled={!item.canManage}
        icon={Trash2Icon}
        size={'small'}
        title={noPermission ?? t('automations.actions.delete')}
        onClick={confirmDelete}
      />
    </Flexbox>
  );
});

RowActions.displayName = 'AutomationRowActions';

export default RowActions;
