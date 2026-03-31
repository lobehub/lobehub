'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Avatar, Button, DropdownMenu, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { App, Tag } from 'antd';
import {
  Eye,
  File,
  Globe,
  Key,
  MoreHorizontalIcon,
  Pencil,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { type FC, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

interface CredItemProps {
  cred: UserCredSummary;
  onDelete: (id: number) => void;
  onEdit: (cred: UserCredSummary) => void;
  onView: (cred: UserCredSummary) => void;
}

const typeIcons: Record<string, React.ReactNode> = {
  'file': <File size={20} />,
  'kv-env': <TerminalSquare size={20} />,
  'kv-header': <Globe size={20} />,
  'oauth': <Key size={20} />,
};

const typeColors: Record<string, string> = {
  'file': 'purple',
  'kv-env': 'blue',
  'kv-header': 'cyan',
  'oauth': 'green',
};

const CredItem: FC<CredItemProps> = memo(({ cred, onEdit, onDelete, onView }) => {
  const { t } = useTranslation('setting');
  const { modal } = App.useApp();

  const handleDelete = () => {
    modal.confirm({
      centered: true,
      content: t('creds.actions.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('creds.actions.deleteConfirm.ok'),
      onOk: () => onDelete(cred.id),
      title: t('creds.actions.deleteConfirm.title'),
      type: 'error',
    });
  };

  const canView = cred.type === 'kv-env' || cred.type === 'kv-header';

  const menuItems = [
    ...(canView
      ? [
          {
            icon: <Icon icon={Eye} />,
            key: 'view',
            label: t('creds.actions.view'),
            onClick: () => onView(cred),
          },
        ]
      : []),
    {
      icon: <Icon icon={Pencil} />,
      key: 'edit',
      label: t('creds.actions.edit'),
      onClick: () => onEdit(cred),
    },
    {
      danger: true,
      icon: <Icon icon={Trash2} />,
      key: 'delete',
      label: t('creds.actions.delete'),
      onClick: handleDelete,
    },
  ];

  const renderAvatar = () => {
    if (cred.type === 'oauth' && cred.oauthAvatar) {
      return <Avatar avatar={cred.oauthAvatar} size={32} />;
    }
    return (
      <span style={{ color: 'var(--lobe-color-text-secondary)' }}>{typeIcons[cred.type]}</span>
    );
  };

  return (
    <Flexbox
      horizontal
      align="center"
      className={styles.container}
      gap={16}
      justify="space-between"
    >
      <Flexbox horizontal align="center" gap={16} style={{ flex: 1, overflow: 'hidden' }}>
        <div className={styles.icon}>{renderAvatar()}</div>
        <Flexbox gap={4} style={{ overflow: 'hidden' }}>
          <Flexbox horizontal align="center" gap={8}>
            <span className={styles.title}>{cred.name}</span>
            <Tag color={typeColors[cred.type]}>{t(`creds.types.${cred.type}`)}</Tag>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8}>
            <code className={styles.key}>{cred.key}</code>
            {cred.description && (
              <>
                <span style={{ color: 'var(--lobe-color-text-quaternary)' }}>·</span>
                <span className={styles.description}>{cred.description}</span>
              </>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal align="center" gap={8} onClick={stopPropagation}>
        <DropdownMenu items={menuItems} placement="bottomRight">
          <Button icon={MoreHorizontalIcon} />
        </DropdownMenu>
      </Flexbox>
    </Flexbox>
  );
});

CredItem.displayName = 'CredItem';

export default CredItem;
