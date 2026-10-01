'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu, Tooltip } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { ChevronRightIcon, MoreHorizontalIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { RuleGroup } from '@/services/expertise';

import { useScopeLabel } from './labels';
import { styles } from './styles';

interface GroupSectionProps {
  collapsed: boolean;
  count: number;
  group: RuleGroup;
  menu: DropdownItem[];
  onToggle: () => void;
  onWrite: () => void;
}

/**
 * A Linear-style group row: one line, a hairline running to the edge of the sheet, and two
 * bordered controls that only appear on hover, sitting in the same column as each row's `…`.
 */
const GroupSection = ({ collapsed, count, group, menu, onToggle, onWrite }: GroupSectionProps) => {
  const { t } = useTranslation('memory');
  const scopeLabel = useScopeLabel();

  return (
    <div className={cx(styles.section, collapsed && styles.sectionCollapsed)} onClick={onToggle}>
      <span className={cx(styles.chevron, !collapsed && styles.chevronOpen)}>
        <Icon icon={ChevronRightIcon} size={14} />
      </span>
      <span className={styles.sectionTitle}>{group.domain.title}</span>
      <span className={styles.sectionCount}>{count}</span>
      <span className={styles.sectionScope}>
        {t('rules.group.scope', { scopes: scopeLabel(group.scopes) })}
      </span>
      {!collapsed && <span data-line className={styles.sectionLine} />}
      <span
        data-hover
        className={cx(styles.hover, styles.sectionActions)}
        onClick={(e) => e.stopPropagation()}
      >
        <Flexbox horizontal gap={2}>
          <Tooltip title={t('rules.actions.writeHere')}>
            <ActionIcon icon={PlusIcon} size={'small'} variant={'outlined'} onClick={onWrite} />
          </Tooltip>
          <DropdownMenu items={menu}>
            <ActionIcon icon={MoreHorizontalIcon} size={'small'} variant={'outlined'} />
          </DropdownMenu>
        </Flexbox>
      </span>
    </div>
  );
};

export default GroupSection;
