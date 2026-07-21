'use client';

import { Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { Button, DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { CheckIcon, ChevronDownIcon, LockIcon, UsersIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useState } from 'react';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    align-self: flex-start;

    width: calc(50% - 4px);
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    @container (max-width: 840px) {
      width: 100%;
    }
  `,
  fullWidth: css`
    width: 100%;
  `,
  policyButton: css`
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    font-size: 14px;
    font-weight: 500;
  `,
}));

interface WorkspaceAgentPolicyCardProps {
  action?: ReactNode;
  children?: ReactNode;
  fullWidth?: boolean;
  icon: LucideIcon;
  title: ReactNode;
}

interface WorkspaceAgentSelectionPolicyMenuProps {
  disabled?: boolean;
  locked: boolean;
  lockedDisabled?: boolean;
  lockedLabel: string;
  onChange: (locked: boolean) => void;
  unlockedLabel: string;
}

export const WorkspaceAgentSelectionPolicyMenu = memo<WorkspaceAgentSelectionPolicyMenuProps>(
  ({ disabled, locked, lockedDisabled, lockedLabel, onChange, unlockedLabel }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const currentLabel = locked ? lockedLabel : unlockedLabel;
    const menuItems: DropdownItem[] = [
      {
        extra: !locked ? <Icon icon={CheckIcon} size={14} /> : undefined,
        icon: UsersIcon,
        key: 'member',
        label: unlockedLabel,
        onClick: () => {
          if (locked) onChange(false);
        },
      },
      {
        disabled: lockedDisabled,
        extra: locked ? <Icon icon={CheckIcon} size={14} /> : undefined,
        icon: LockIcon,
        key: 'fixed',
        label: lockedLabel,
        onClick: () => {
          if (!locked) onChange(true);
        },
      },
    ];

    return (
      <DropdownMenu
        items={menuItems}
        open={menuOpen}
        placement={'bottomRight'}
        popupProps={{ style: { minWidth: 180 } }}
        onOpenChange={setMenuOpen}
      >
        <Tooltip disabled={menuOpen} title={currentLabel}>
          <Button
            aria-label={currentLabel}
            className={styles.policyButton}
            disabled={disabled}
            icon={locked ? LockIcon : UsersIcon}
            size={'small'}
            type={'text'}
          >
            <Icon aria-hidden icon={ChevronDownIcon} size={12} />
          </Button>
        </Tooltip>
      </DropdownMenu>
    );
  },
);

WorkspaceAgentSelectionPolicyMenu.displayName = 'WorkspaceAgentSelectionPolicyMenu';

export const WorkspaceAgentPolicyCard = memo<WorkspaceAgentPolicyCardProps>(
  ({ action, children, fullWidth, icon, title }) => (
    <Flexbox className={cx(styles.card, fullWidth && styles.fullWidth)} gap={12}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon icon={icon} size={16} />
          <Text className={styles.title}>{title}</Text>
        </Flexbox>
        {action}
      </Flexbox>
      {children}
    </Flexbox>
  ),
);

WorkspaceAgentPolicyCard.displayName = 'WorkspaceAgentPolicyCard';
