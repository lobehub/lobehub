'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon, MoreHorizontalIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { RuleGroup } from '@/services/expertise';

import { useScopeLabel } from './labels';
import { hoverHostMarker } from './markers.stylex';
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
  const owner = group.owner;
  const onlyItsAgent =
    owner.kind === 'agent' &&
    group.scopes.every((scope) => scope.kind === 'agent' && scope.id === owner.agent.id);

  return (
    <div
      {...stylex.props(styles.section, collapsed && styles.sectionCollapsed, hoverHostMarker)}
      onClick={onToggle}
    >
      <span {...stylex.props(styles.chevron, !collapsed && styles.chevronOpen)}>
        <Icon icon={ChevronRightIcon} size={14} />
      </span>
      <span {...stylex.props(styles.sectionTitle)}>{group.domain.title}</span>
      <span {...stylex.props(styles.sectionCount)}>{count}</span>
      {/* Under an agent's heading, "applies to that agent" only repeats the heading. */}
      {!onlyItsAgent && (
        <span {...stylex.props(styles.sectionScope)}>
          {t('rules.group.scope', { scopes: scopeLabel(group.scopes) })}
        </span>
      )}
      {!collapsed && <span data-line {...stylex.props(styles.sectionLine)} />}
      <span
        data-hover
        {...stylex.props(styles.hover, styles.sectionActions)}
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
