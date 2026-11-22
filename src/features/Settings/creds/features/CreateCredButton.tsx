'use client';

import { type CredType } from '@lobechat/types';
import { Button, DropdownMenu, Icon } from '@lobehub/ui';
import { ChevronDown, Plus } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { CRED_TYPE_ICONS, CRED_TYPES } from './credTypes';

interface CreateCredButtonProps {
  disabled?: boolean;
  onCreate: (type: CredType) => void;
  size?: 'large';
}

/**
 * "New credential" opens a menu of credential types; picking one opens that
 * type's form directly, so creating a credential takes no separate type step.
 */
const CreateCredButton: FC<CreateCredButtonProps> = ({ disabled, onCreate, size }) => {
  const { t } = useTranslation('setting');

  const button = (
    <Button disabled={disabled} icon={<Icon icon={Plus} />} size={size} type={'primary'}>
      {t('creds.create')}
      <Icon icon={ChevronDown} size={14} />
    </Button>
  );

  if (disabled) return button;

  return (
    <DropdownMenu
      iconAlign={'start'}
      placement={'bottomRight'}
      items={CRED_TYPES.map((type) => ({
        desc: t(`creds.typeDesc.${type}`),
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
