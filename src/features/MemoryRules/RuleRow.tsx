'use client';

import type { ExpertiseEnforcement } from '@lobechat/types';
import { Flexbox, SortableList } from '@lobehub/ui';
import {
  ActionIcon,
  type DropdownItem,
  DropdownMenu,
  Input,
  Tag,
  Tooltip,
} from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import dayjs from 'dayjs';
import { CheckIcon, MoreHorizontalIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RuleItem } from '@/services/expertise';

import EnforcementToggle from './EnforcementToggle';
import { styles } from './styles';

interface RuleRowProps {
  active: boolean;
  /** Where an archived rule went, when it was folded into another one. */
  archivedInto?: string | null;
  code: string;
  editing: boolean;
  menu: DropdownItem[];
  onEnforcement: (next: ExpertiseEnforcement) => void;
  onSelect: () => void;
  onStopEdit: () => void;
  onTitle: (title: string) => void;
  rule: RuleItem;
}

/**
 * One line of the sheet. Everything that acts on the row — the drag handle, the effect switch,
 * the `…` menu, the inline title editor — stops its click so the row itself only ever opens the
 * document.
 */
const RuleRow = ({
  active,
  archivedInto,
  code,
  editing,
  menu,
  onEnforcement,
  onSelect,
  onStopEdit,
  onTitle,
  rule,
}: RuleRowProps) => {
  const { t } = useTranslation('memory');
  const [draft, setDraft] = useState(rule.title);
  const archived = rule.status === 'retired';
  const authored = Boolean(rule.createdByUserId) && rule.hitCount === 0;

  const commit = () => {
    const next = draft.trim();
    if (next && next !== rule.title) onTitle(next);
    onStopEdit();
  };

  const archivedWhy = archivedInto
    ? t('rules.archived.mergedInto', { title: archivedInto })
    : t('rules.archived.byYou');

  return (
    <SortableList.Item id={rule.id} style={{ padding: 0, width: '100%' }} variant={'borderless'}>
      <div
        className={cx(
          styles.grid,
          styles.row,
          styles.rowHover,
          active && styles.rowActive,
          archived && styles.rowArchived,
        )}
        onClick={onSelect}
      >
        <span data-hover className={styles.hover} onClick={(e) => e.stopPropagation()}>
          {!archived && <SortableList.DragHandle size={'small'} />}
        </span>
        <span className={styles.cellId}>{code}</span>
        <div style={{ minWidth: 0 }}>
          {editing ? (
            <Flexbox horizontal align={'center'} gap={6} onClick={(e) => e.stopPropagation()}>
              <Input
                autoFocus
                size={'small'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') onStopEdit();
                }}
              />
              <ActionIcon icon={CheckIcon} size={'small'} onClick={commit} />
              <ActionIcon icon={XIcon} size={'small'} onClick={onStopEdit} />
            </Flexbox>
          ) : (
            <Flexbox horizontal align={'baseline'} gap={6} wrap={'wrap'}>
              <span className={styles.title}>{rule.title}</span>
              {authored && <Tag size={'small'}>{t('rules.tag.authored')}</Tag>}
              {archived && (
                <span className={styles.muted}>
                  {t('rules.archived.at', {
                    time: dayjs(rule.retiredAt ?? undefined).format('YYYY-MM-DD'),
                  })}
                  {' · '}
                  {archivedWhy}
                </span>
              )}
            </Flexbox>
          )}
        </div>
        <EnforcementToggle disabled={archived} value={rule.enforcement} onChange={onEnforcement} />
        <span className={styles.muted}>{t(`rules.method.${rule.compilability}`)}</span>
        <Tooltip
          title={
            rule.hitRunCount
              ? t('rules.runs.detail', { hits: rule.hitCount, runs: rule.hitRunCount })
              : t('rules.runs.none')
          }
        >
          <span className={styles.muted}>
            {rule.hitRunCount ? t('rules.runs.count', { count: rule.hitRunCount }) : '—'}
          </span>
        </Tooltip>
        <span data-hover className={styles.hover} onClick={(e) => e.stopPropagation()}>
          <DropdownMenu items={menu}>
            <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
          </DropdownMenu>
        </span>
      </div>
    </SortableList.Item>
  );
};

export default RuleRow;
