'use client';

import { ActionIcon, Block, DropdownMenu, Flexbox, Icon, Image } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import type { Klavis } from 'klavis';
import { Loader2, MoreVerticalIcon, Plus, Unplug } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useItemStyles } from '../style';
import { useSkillConnect } from './useSkillConnect';

interface ItemProps {
  description?: string;
  icon: string | React.ComponentType;
  identifier: string;
  isConnected: boolean;
  label: string;
  onOpenDetail?: () => void;
  serverName?: Klavis.McpServerName;
  type: 'klavis' | 'lobehub';
}

const Item = memo<ItemProps>(
  ({ description, icon, identifier, label, onOpenDetail, serverName, type }) => {
    const { t } = useTranslation('setting');
    const { styles } = useItemStyles();
    const { modal } = App.useApp();

    const { handleConnect, handleDisconnect, isConnected, isConnecting } = useSkillConnect({
      identifier,
      serverName,
      type,
    });

    // Get localized description
    const i18nPrefix = type === 'klavis' ? 'tools.klavis.servers' : 'tools.lobehubSkill.providers';
    // @ts-ignore
    const localizedDescription = t(`${i18nPrefix}.${identifier}.description`, {
      defaultValue: description,
    });

    const confirmDisconnect = () => {
      modal.confirm({
        cancelText: t('cancel', { ns: 'common' }),
        centered: true,
        content: t('tools.lobehubSkill.disconnectConfirm.desc', { name: label }),
        okButtonProps: { danger: true },
        okText: t('tools.lobehubSkill.disconnect'),
        onOk: handleDisconnect,
        title: t('tools.lobehubSkill.disconnectConfirm.title', { name: label }),
      });
    };

    const renderIcon = () => {
      if (typeof icon === 'string') {
        return <Image alt={label} height={40} src={icon} width={40} />;
      }
      return <Icon fill={cssVar.colorText} icon={icon as any} size={40} />;
    };

    const renderAction = () => {
      if (isConnecting) {
        return <ActionIcon icon={Loader2} loading />;
      }

      if (isConnected) {
        return (
          <DropdownMenu
            items={[
              {
                icon: <Icon icon={Unplug} />,
                key: 'disconnect',
                label: t('tools.lobehubSkill.disconnect'),
                onClick: confirmDisconnect,
              },
            ]}
            placement="bottomRight"
          >
            <ActionIcon icon={MoreVerticalIcon} />
          </DropdownMenu>
        );
      }

      return (
        <ActionIcon icon={Plus} onClick={handleConnect} title={t('tools.lobehubSkill.connect')} />
      );
    };

    return (
      <Block
        align={'center'}
        className={styles.container}
        gap={12}
        horizontal
        onClick={onOpenDetail}
        paddingBlock={12}
        paddingInline={12}
        style={{ cursor: 'pointer' }}
        variant={'filled'}
      >
        {renderIcon()}
        <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
          <span className={styles.title}>{label}</span>
          {localizedDescription && (
            <span className={styles.description}>{localizedDescription}</span>
          )}
        </Flexbox>
        <div onClick={(e) => e.stopPropagation()}>{renderAction()}</div>
      </Block>
    );
  },
);

Item.displayName = 'LobeHubListItem';

export default Item;
