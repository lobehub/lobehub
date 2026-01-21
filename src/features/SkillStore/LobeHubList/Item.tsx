'use client';

import { ActionIcon, Block, Dropdown, Flexbox, Icon, Image } from '@lobehub/ui';
import { App } from 'antd';
import { createStyles, cssVar } from 'antd-style';
import type { Klavis } from 'klavis';
import { Loader2, MoreVerticalIcon, Plus, Unplug } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useSkillConnect } from './useSkillConnect';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    position: relative;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  `,
  description: css`
    overflow: hidden;

    font-size: 12px;
    color: ${token.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: 8px;

    background: ${token.colorFillTertiary};
  `,
  title: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    color: ${token.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

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
    const { styles } = useStyles();
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
        return <Image alt={label} height={20} src={icon} width={20} />;
      }
      return <Icon fill={cssVar.colorText} icon={icon as any} size={20} />;
    };

    const renderAction = () => {
      if (isConnecting) {
        return <ActionIcon icon={Loader2} loading />;
      }

      if (isConnected) {
        return (
          <Dropdown
            menu={{
              items: [
                {
                  icon: <Icon icon={Unplug} />,
                  key: 'disconnect',
                  label: t('tools.lobehubSkill.disconnect'),
                  onClick: confirmDisconnect,
                },
              ],
            }}
            placement="bottomRight"
            trigger={['click']}
          >
            <ActionIcon icon={MoreVerticalIcon} />
          </Dropdown>
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
        <div className={styles.icon}>{renderIcon()}</div>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0, overflow: 'hidden' }}>
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
