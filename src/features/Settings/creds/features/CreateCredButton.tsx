'use client';

import { type CredType } from '@lobechat/types';
import { Button, DropdownMenu, Icon } from '@lobehub/ui';
import { ChevronDown } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { CRED_TYPE_ICONS, CRED_TYPES } from './credTypes';

interface CreateCredButtonProps {
  disabled?: boolean;
  onCreate: (type: CredType) => void;
  size?: 'large';
}

/**
 * "New credential" opens a compact menu of credential types (icon + name);
 * picking one opens that type's form directly, so creating a credential takes
 * no separate type step. Each form explains its type in its own field hints.
 */
const CreateCredButton: FC<CreateCredButtonProps> = ({ disabled, onCreate, size }) => {
  const { t } = useTranslation('setting');

  const button = (
    // `data-no-highlight` keeps the open-menu trigger highlight (a grey fill)
    // off the primary button, which would leave its white label unreadable.
    <Button data-no-highlight disabled={disabled} size={size} type={'primary'}>
      {t('creds.create')}
      <Icon icon={ChevronDown} size={14} />
    </Button>
  );

  if (disabled) return button;

  return (
    <DropdownMenu
      placement={'bottomRight'}
      items={CRED_TYPES.map((type) => ({
        icon: <Icon icon={CRED_TYPE_ICONS[type]} />,
        key: type,
        label: t(`creds.types.${type}`),
        onClick: () => onCreate(type),
      }))}
    >
      {button}
    </DropdownMenu>
  );
};

export default CreateCredButton;
