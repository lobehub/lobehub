'use client';

import { type UserCredSummary } from '@lobechat/types';
import {
  ActionIcon,
  Avatar,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  stopPropagation,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Eye, MoreHorizontalIcon, Pencil, Trash2 } from 'lucide-react';
import { type FC, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDensity } from '@/styles/density';

import { CRED_TYPE_ICONS } from './credTypes';
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
  /** Tags shown after the name (owner, sharing state). */
  tags?: React.ReactNode;
  /** Inline marker right after the name, e.g. the private lock in the workspace list. */
  titleSuffix?: React.ReactNode;
}

const CredItem: FC<CredItemProps> = memo(
  ({ canManage, cred, extraMenuItems = [], onEdit, onDelete, onView, tags, titleSuffix }) => {
    const { t } = useTranslation(['setting', 'common']);
    const { compact, tokens } = useDensity();

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
        return <Avatar avatar={cred.oauthAvatar} size={tokens.controlHeight} />;
      }
      return (
        // `display: flex` collapses the inline span's line box so the svg sits
        // dead-center in the 48px container instead of on the text baseline.
        <span style={{ color: 'var(--lobe-color-text-secondary)', display: 'flex' }}>
          <Icon icon={CRED_TYPE_ICONS[cred.type]} size={20} />
        </span>
      );
    };

    return (
      <Flexbox
        horizontal
        align="center"
        className={stylex.props(styles.container, compact && styles.containerCompact).className}
        gap={tokens.sectionGap}
        justify="space-between"
      >
        <Flexbox
          horizontal
          align="center"
          gap={tokens.sectionGap}
          style={{ flex: 1, overflow: 'hidden' }}
        >
          <div {...stylex.props(styles.icon, compact && styles.iconCompact)}>{renderAvatar()}</div>
          <Flexbox gap={compact ? 2 : 4} style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <Flexbox horizontal align="center" gap={8}>
              <span {...stylex.props(styles.title, compact && styles.titleCompact)}>
                {cred.name}
              </span>
              {titleSuffix}
              {tags}
            </Flexbox>
            {cred.description && (
              <span {...stylex.props(styles.description, compact && styles.descriptionCompact)}>
                {cred.description}
              </span>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={8} onClick={stopPropagation}>
          {menuItems.length > 0 && (
            <DropdownMenu items={menuItems} placement="bottomRight">
              <ActionIcon icon={MoreHorizontalIcon} title={t('more', { ns: 'common' })} />
            </DropdownMenu>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

CredItem.displayName = 'CredItem';

export default CredItem;
