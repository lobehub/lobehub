'use client';

import { type UserCredSummary } from '@lobechat/types';
import {
  Avatar,
  Button,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  stopPropagation,
  Tag,
} from '@lobehub/ui';
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
  /** Whether the view / edit / delete handlers may run; they render disabled otherwise. */
  canManage: boolean;
  cred: UserCredSummary;
  /** Row-specific actions (publish, share…) listed before view / edit / delete. */
  extraMenuItems?: DropdownItem[];
  /**
   * Action handlers are optional: omit one to leave its item out. A row with
   * no items renders no "..." menu.
   */
  onDelete?: (id: number) => void;
  onEdit?: (cred: UserCredSummary) => void;
  onView?: (cred: UserCredSummary) => void;
  /** Tags shown after the type tag (owner, sharing state). */
  tags?: React.ReactNode;
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

const CredItem: FC<CredItemProps> = memo(
  ({ canManage, cred, extraMenuItems = [], onEdit, onDelete, onView, tags }) => {
    const { t } = useTranslation('setting');

    const handleDelete = () => {
      if (!canManage) return;

      confirmModal({
        content: t('creds.actions.deleteConfirm.content'),
        okButtonProps: { danger: true },
        okText: t('creds.actions.deleteConfirm.ok'),
        onOk: () => onDelete?.(cred.id),
        title: t('creds.actions.deleteConfirm.title'),
      });
    };

    const canView = canManage && (cred.type === 'kv-env' || cred.type === 'kv-header');

    const menuItems: DropdownItem[] = [
      ...extraMenuItems,
      ...(onView && canView
        ? [
            {
              icon: <Icon icon={Eye} />,
              key: 'view',
              label: t('creds.actions.view'),
              onClick: () => onView(cred),
            },
          ]
        : []),
      ...(onEdit
        ? [
            {
              icon: <Icon icon={Pencil} />,
              key: 'edit',
              label: t('creds.actions.edit'),
              disabled: !canManage,
              onClick: () => onEdit(cred),
            },
          ]
        : []),
      ...(onDelete
        ? [
            {
              danger: true,
              disabled: !canManage,
              icon: <Icon icon={Trash2} />,
              key: 'delete',
              label: t('creds.actions.delete'),
              onClick: handleDelete,
            },
          ]
        : []),
    ];

    const renderAvatar = () => {
      if (cred.type === 'oauth' && cred.oauthAvatar) {
        return <Avatar avatar={cred.oauthAvatar} size={32} />;
      }
      return (
        // `display: flex` collapses the inline span's line box so the svg sits
        // dead-center in the 48px container instead of on the text baseline.
        <span style={{ color: 'var(--lobe-color-text-secondary)', display: 'flex' }}>
          {typeIcons[cred.type]}
        </span>
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
              {tags}
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
          {menuItems.length > 0 && (
            <DropdownMenu items={menuItems} placement="bottomRight">
              <Button icon={MoreHorizontalIcon} />
            </DropdownMenu>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

CredItem.displayName = 'CredItem';

export default CredItem;
