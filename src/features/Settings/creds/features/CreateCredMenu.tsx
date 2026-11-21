'use client';

import { type CredType } from '@lobechat/types';
import { Button, DropdownMenu, Icon, Tooltip } from '@lobehub/ui';
import { ChevronDown, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import { createCreateCredModal } from './CreateCredModal';
import { CRED_TYPE_ICONS } from './credTypeIcons';
import { personalCredsApi } from './useCredsApi';

const CREATE_ORDER: CredType[] = ['kv-env', 'kv-header', 'oauth', 'file'];

interface CreateCredMenuProps {
  onCreated: () => void;
  size?: 'large';
}

/**
 * The vault's create action: a menu of item types, each opening the create
 * form for that type directly.
 */
const CreateCredMenu = memo<CreateCredMenuProps>(({ onCreated, size }) => {
  const { t } = useTranslation('setting');
  const { allowed: canManage, reason } = usePermission('manage_provider_key');

  // `data-no-highlight`: the open-menu trigger tint would wash out the primary fill.
  const button = (
    <Button
      data-no-highlight
      disabled={!canManage}
      icon={<Icon icon={Plus} />}
      size={size}
      type={'primary'}
    >
      {t('creds.create')}
      <Icon icon={ChevronDown} size={14} />
    </Button>
  );

  // Disabled buttons swallow hover events, so the tooltip needs a wrapper.
  if (!canManage)
    return (
      <Tooltip title={reason}>
        <span>{button}</span>
      </Tooltip>
    );

  return (
    <DropdownMenu
      placement={'bottomRight'}
      items={CREATE_ORDER.map((type) => ({
        icon: <Icon icon={CRED_TYPE_ICONS[type]} />,
        key: type,
        label: t(`creds.types.${type}`),
        onClick: () =>
          createCreateCredModal({
            credsApi: personalCredsApi,
            initialType: type,
            onSuccess: onCreated,
          }),
      }))}
    >
      {button}
    </DropdownMenu>
  );
});

CreateCredMenu.displayName = 'CreateCredMenu';

export default CreateCredMenu;
