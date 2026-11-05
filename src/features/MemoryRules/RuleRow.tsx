'use client';

import type { ExpertiseEnforcement, ExpertiseRuleDirection } from '@lobechat/types';
import { Flexbox, SortableList } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu, Tag, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { MoreHorizontalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { RuleItem } from '@/services/expertise';

import DirectionToggle from './DirectionToggle';
import EnforcementToggle from './EnforcementToggle';
import { hoverHostMarker } from './markers.stylex';
import { styles } from './styles';

interface RuleRowProps {
  active: boolean;
  /** Where an archived rule went, when it was folded into another one. */
  archivedInto?: string | null;
  code: string;
  /** Off while the sheet is sorted by a column: that order is not the reviewer's to drag. */
  draggable?: boolean;
  menu: DropdownItem[];
  onDirection: (next: ExpertiseRuleDirection) => void;
  onEnforcement: (next: ExpertiseEnforcement) => void;
  onSelect: () => void;
  rule: RuleItem;
  /** Whether the row sits in an agent's part, where what the reviewer wrote was taught to it. */
  taughtToAgent?: boolean;
}

/**
 * One line of the sheet. Everything that acts on the row — the drag handle, the effect switch,
 * the `…` menu — stops its click so the row itself only ever opens the document. Rewording
 * happens in the document, not here: a text box inside a table row reads as a glitch.
 */
const RuleRow = ({
  active,
  archivedInto,
  code,
  draggable = true,
  menu,
  onDirection,
  onEnforcement,
  onSelect,
  rule,
  taughtToAgent,
}: RuleRowProps) => {
  const { t } = useTranslation('memory');
  const archived = rule.status === 'retired';
  const authored = rule.authored;

  const archivedWhy = archivedInto
    ? t('rules.archived.mergedInto', { title: archivedInto })
    : t('rules.archived.byYou');

  return (
    <SortableList.Item id={rule.id} style={{ padding: 0, width: '100%' }} variant={'borderless'}>
      <div
        {...stylex.props(
          styles.grid,
          styles.row,
          active && styles.rowActive,
          archived && styles.rowArchived,
          hoverHostMarker,
        )}
        onClick={onSelect}
      >
        <span data-hover {...stylex.props(styles.hover)} onClick={(e) => e.stopPropagation()}>
          {!archived && draggable && <SortableList.DragHandle size={'small'} />}
        </span>
        <span {...stylex.props(styles.cellId)}>{code}</span>
        <div style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'baseline'} gap={6} wrap={'wrap'}>
            <span {...stylex.props(styles.title)}>{rule.title}</span>
            {authored && (
              <Tag size={'small'}>
                {t(taughtToAgent ? 'rules.tag.taught' : 'rules.tag.authored')}
              </Tag>
            )}
            {rule.specificity === 'one-off' && !archived && (
              <Tooltip title={t('rules.origin.oneOff')}>
                <Tag size={'small'}>{t('rules.tag.oneOff')}</Tag>
              </Tooltip>
            )}
            {archived && (
              <span {...stylex.props(styles.muted)}>
                {t('rules.archived.at', {
                  time: dayjs(rule.retiredAt ?? undefined).format('YYYY-MM-DD'),
                })}
                {' · '}
                {archivedWhy}
              </span>
            )}
          </Flexbox>
        </div>
        <DirectionToggle disabled={archived} value={rule.direction} onChange={onDirection} />
        <EnforcementToggle disabled={archived} value={rule.enforcement} onChange={onEnforcement} />
        <span {...stylex.props(styles.muted)}>{t(`rules.method.${rule.compilability}`)}</span>
        <Tooltip
          title={
            rule.hitRunCount
              ? t('rules.runs.detail', { hits: rule.hitCount, runs: rule.hitRunCount })
              : t('rules.runs.none')
          }
        >
          <span {...stylex.props(styles.muted)}>
            {rule.hitRunCount ? t('rules.runs.count', { count: rule.hitRunCount }) : '—'}
          </span>
        </Tooltip>
        <span data-hover {...stylex.props(styles.hover)} onClick={(e) => e.stopPropagation()}>
          <DropdownMenu items={menu}>
            <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
          </DropdownMenu>
        </span>
      </div>
    </SortableList.Item>
  );
};

export default RuleRow;
