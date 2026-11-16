'use client';

import { Avatar, confirmModal, cssVar, Icon } from '@lobehub/ui';
import { Unplug } from 'lucide-react';
import type React from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { RowAddAction, RowMoreMenu } from '@/features/Settings/skill/features/RowActions';
import SkillListRow from '@/features/Settings/skill/features/SkillListRow';
import { usePermission } from '@/hooks/usePermission';

import { useSkillConnect } from './useSkillConnect';

interface ItemProps {
  description?: string;
  icon: string | React.ComponentType;
  identifier: string;
  isConnected: boolean;
  label: string;
  onOpenDetail?: () => void;
  serverName?: string;
  type: 'composio' | 'lobehub';
}

/** A LobeHub / Composio provider in the store, drawn as the Connectors page row. */
const Item = memo<ItemProps>(
  ({ description, icon, identifier, label, onOpenDetail, serverName, type }) => {
    const { t } = useTranslation('setting');
    const { allowed: canCreate } = usePermission('create_content');
    const { allowed: canEdit } = usePermission('edit_own_content');

    const { handleConnect, handleDisconnect, isConnected, isConnecting } = useSkillConnect({
      identifier,
      serverName,
      type,
    });

    // Get localized description
    const i18nPrefix =
      type === 'composio' ? 'tools.composio.servers' : 'tools.lobehubSkill.providers';
    // @ts-ignore
    const localizedDescription = t(`${i18nPrefix}.${identifier}.description`, {
      defaultValue: description,
    });

    const confirmDisconnect = () => {
      if (!canEdit) return;
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('tools.lobehubSkill.disconnectConfirm.desc', { name: label }),
        okButtonProps: { danger: true },
        okText: t('tools.lobehubSkill.disconnect'),
        onOk: handleDisconnect,
        title: t('tools.lobehubSkill.disconnectConfirm.title', { name: label }),
      });
    };

    return (
      <SkillListRow
        summary={localizedDescription}
        title={label}
        extra={
          isConnected ? (
            <RowMoreMenu
              items={[
                {
                  danger: true,
                  disabled: !canEdit,
                  icon: <Icon icon={Unplug} />,
                  key: 'disconnect',
                  label: t('tools.lobehubSkill.disconnect'),
                  onClick: confirmDisconnect,
                },
              ]}
              onOpenDetail={onOpenDetail}
            />
          ) : (
            <RowAddAction
              disabled={!canCreate || !canEdit}
              label={t('tools.lobehubSkill.connect')}
              loading={isConnecting}
              onClick={handleConnect}
            />
          )
        }
        icon={() =>
          typeof icon === 'string' ? (
            <Avatar alt={label} avatar={icon} size={20} />
          ) : (
            <Icon fill={cssVar.colorText} icon={icon as any} size={20} />
          )
        }
        onClick={onOpenDetail}
      />
    );
  },
);

Item.displayName = 'LobeHubListItem';

export default Item;
