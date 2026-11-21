'use client';

import { type WebhookEndpointItem } from '@lobechat/types';
import { ActionIcon, DropdownMenu, Flexbox } from '@lobehub/ui';
import {
  HistoryIcon,
  KeyRoundIcon,
  MoreHorizontal,
  PencilIcon,
  SendIcon,
  Trash,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type useWebhookActions } from './useWebhookActions';

interface RowActionsProps {
  actions: ReturnType<typeof useWebhookActions>;
  endpoint: WebhookEndpointItem;
  onOpenDeliveries: () => void;
}

/**
 * Test and Deliveries are the actions people repeat while wiring a receiver, so
 * they stay on the row; the rarer or destructive ones sit in the menu.
 */
export const RowActions = ({ actions, endpoint, onOpenDeliveries }: RowActionsProps) => {
  const { t } = useTranslation('setting');
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    try {
      await actions.test(endpoint);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Flexbox horizontal align={'center'} gap={2}>
      <ActionIcon
        aria-label={t('webhook.actions.test')}
        icon={SendIcon}
        loading={testing}
        size={'small'}
        title={t('webhook.actions.test')}
        onClick={test}
      />
      <ActionIcon
        aria-label={t('webhook.actions.deliveries')}
        icon={HistoryIcon}
        size={'small'}
        title={t('webhook.actions.deliveries')}
        onClick={onOpenDeliveries}
      />
      <DropdownMenu
        placement={'bottomRight'}
        items={[
          {
            icon: PencilIcon,
            key: 'edit',
            label: t('webhook.actions.edit'),
            onClick: () => actions.edit(endpoint),
          },
          {
            icon: KeyRoundIcon,
            key: 'rotate',
            label: t('webhook.actions.rotateSecret'),
            onClick: () => actions.rotateSecret(endpoint),
          },
          { type: 'divider' },
          {
            danger: true,
            icon: Trash,
            key: 'delete',
            label: t('webhook.actions.delete'),
            onClick: () => actions.remove(endpoint),
          },
        ]}
      >
        <ActionIcon icon={MoreHorizontal} size={'small'} title={t('webhook.actions.more')} />
      </DropdownMenu>
    </Flexbox>
  );
};
