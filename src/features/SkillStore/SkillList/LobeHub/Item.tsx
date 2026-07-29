'use client';

import { ActionIcon, Block, DropdownMenu, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Loader2, MoreVerticalIcon, Plus, Unplug } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import { itemStyles } from '../style';
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

const Item = memo<ItemProps>(
  ({ description, icon, identifier, label, onOpenDetail, serverName, type }) => {
    const { t } = useTranslation('setting');
    const styles = itemStyles;
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

    const renderIcon = () => {
      if (typeof icon === 'string') {
        return <img alt={label} height={40} src={icon} width={40} />;
      }
      return <Icon fill={cssVar.colorText} icon={icon as any} size={40} />;
    };

    const renderAction = () => {
      if (isConnecting) {
        return <ActionIcon loading icon={Loader2} />;
      }

      if (isConnected) {
        return (
          <DropdownMenu
            nativeButton={false}
            placement="bottomRight"
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
          >
            <ActionIcon disabled={!canEdit} icon={MoreVerticalIcon} />
          </DropdownMenu>
        );
      }

      return (
        <ActionIcon
          disabled={!canCreate || !canEdit}
          icon={Plus}
          title={t('tools.lobehubSkill.connect')}
          onClick={() => {
            if (!canCreate || !canEdit) return;
            handleConnect();
          }}
        />
      );
    };

    return (
      <Block
        horizontal
        align={'center'}
        className={styles.container}
        gap={12}
        paddingBlock={12}
        paddingInline={12}
        style={{ cursor: 'pointer' }}
        variant={'outlined'}
        onClick={onOpenDetail}
      >
        {renderIcon()}
        <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
          <span className={styles.title}>{label}</span>
          {localizedDescription && (
            <span className={styles.description}>{localizedDescription}</span>
          )}
        </Flexbox>
        <div onClick={stopPropagation}>{renderAction()}</div>
      </Block>
    );
  },
);

Item.displayName = 'LobeHubListItem';

export default Item;
