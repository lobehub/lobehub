'use client';

import {
  ActionIcon,
  createStaticStyles,
  cssVar,
  cx,
  DropdownMenuHeader,
  DropdownMenuItem,
  DropdownMenuScrollViewport,
  Icon,
  Input,
  Text,
} from '@lobehub/ui';
import { PinIcon, SearchIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import AsyncBoundary from '@/components/AsyncBoundary';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { type AgentRow, useHomeAgentRows } from './useHomeAgentRows';

/** Row height hint for the virtual list — keep in sync with `styles.item`. */
const ROW_HEIGHT = 36;
const SECTION_HEIGHT = 28;
const MAX_LIST_HEIGHT = 360;

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    background: ${cssVar.colorFillTertiary};
  `,
  empty: css`
    padding-block: 24px;
    padding-inline: 12px;

    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  header: css`
    padding: 0;
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    height: ${ROW_HEIGHT}px;
    padding-block: 0;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  searchBar: css`
    padding-block: 4px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorSplit};
  `,
  // Same spec as the agent-detail SwitchPanel's section header.
  section: css`
    height: ${SECTION_HEIGHT}px;
    padding-block: 4px 2px;
    padding-inline: 8px;

    font-size: 12px;
    font-weight: 500;
    line-height: 20px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface AgentListProps {
  activeAgentId: string;
  /** Thrown error from the agent-list SWR — surfaced as a failure state. */
  error?: unknown;
  onRetry?: () => void;
  onSelect: (agentId: string) => void;
}

type ListRow =
  { key: string; kind: 'section'; label: string } | { key: string; kind: 'agent'; row: AgentRow };

const toAgentRow = (row: AgentRow): ListRow => ({ key: row.id, kind: 'agent', row });
const toSectionRow = (key: string, label: string): ListRow => ({ key, kind: 'section', label });

const AgentList = memo<AgentListProps>(({ activeAgentId, error, onRetry, onSelect }) => {
  const { t } = useTranslation('common');
  const [search, setSearch] = useState('');

  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const { privateRows, showPrivateSection, workspaceRows } = useHomeAgentRows();

  const rows = useMemo<ListRow[]>(() => {
    const query = search.trim().toLowerCase();
    const match = (row: AgentRow) =>
      !query ||
      row.title.toLowerCase().includes(query) ||
      (row.subtitle ?? '').toLowerCase().includes(query);

    const privateMatches = privateRows.filter(match);
    const workspaceMatches = workspaceRows.filter(match);

    if (!showPrivateSection) return [...workspaceMatches, ...privateMatches].map(toAgentRow);

    // A section whose rows were all filtered out drops its header too — an
    // empty label above nothing reads as a bug.
    const out: ListRow[] = [];
    if (privateMatches.length > 0) {
      out.push(toSectionRow('section-private', t('navPanel.privateAgents')));
      out.push(...privateMatches.map(toAgentRow));
    }
    if (workspaceMatches.length > 0) {
      out.push(toSectionRow('section-workspace', t('navPanel.publicAgents')));
      out.push(...workspaceMatches.map(toAgentRow));
    }
    return out;
  }, [privateRows, search, showPrivateSection, t, workspaceRows]);

  // The virtual viewport needs an explicit height; clamp to the old 360px cap
  // so a long list scrolls instead of growing the popup.
  const contentHeight = rows.reduce(
    (sum, item) => sum + (item.kind === 'section' ? SECTION_HEIGHT : ROW_HEIGHT),
    0,
  );
  const listHeight = Math.min(Math.max(contentHeight, ROW_HEIGHT), MAX_LIST_HEIGHT);

  // Error gated ahead of the skeleton so a failed list fetch shows Retry instead
  // of a permanent skeleton (`isAgentListInit` only flips on success).
  return (
    <AsyncBoundary
      data={isInit ? workspaceRows : undefined}
      error={error}
      errorVariant={'block'}
      isLoading={!isInit && !error}
      loading={<SkeletonList rows={6} style={{ padding: 8 }} />}
      onRetry={onRetry}
    >
      <DropdownMenuHeader className={styles.header}>
        <div className={styles.searchBar}>
          <Input
            autoFocus
            placeholder={t('navPanel.searchAgent')}
            prefix={<Icon icon={SearchIcon} size={14} />}
            size={'small'}
            style={{ paddingInline: 0 }}
            value={search}
            variant={'borderless'}
            onChange={(e) => setSearch(e.target.value)}
            // Let arrows / Esc reach the menu (they move focus into the list and
            // close it); keep plain typing from triggering menu typeahead.
            onKeyDown={(e) => {
              const isMenuKey = e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp';
              if (!isMenuKey) e.stopPropagation();
            }}
          />
        </div>
      </DropdownMenuHeader>
      {rows.length === 0 ? (
        <div className={styles.empty}>{t('navPanel.searchResultEmpty')}</div>
      ) : (
        <DropdownMenuScrollViewport
          // virtua sizes itself on mount; remount when the filtered count changes
          // so a narrowed list never leaves stale rows undrawn.
          virtual
          key={rows.length}
          listItemHeight={ROW_HEIGHT}
          style={{ height: listHeight }}
          getItemLabel={(_, index) => {
            const item = rows[index];
            return item?.kind === 'agent' ? item.row.title : undefined;
          }}
        >
          {rows.map((item) =>
            item.kind === 'section' ? (
              // `aria-disabled` keeps typeahead / Home-End from landing on a
              // header row: the virtual list skips disabled entries.
              <div aria-disabled className={styles.section} key={item.key}>
                {item.label}
              </div>
            ) : (
              <DropdownMenuItem
                className={cx(styles.item, item.row.id === activeAgentId && styles.active)}
                key={item.key}
                onClick={() => onSelect(item.row.id)}
              >
                <AgentAvatar
                  agentId={item.row.id}
                  avatar={item.row.avatar}
                  background={item.row.backgroundColor}
                  name={item.row.title}
                  shape={'square'}
                  size={24}
                />
                <Text
                  ellipsis
                  style={{ flex: 1 }}
                  weight={item.row.id === activeAgentId ? 600 : 500}
                  color={
                    item.row.id === activeAgentId ? cssVar.colorText : cssVar.colorTextSecondary
                  }
                >
                  {item.row.title}
                </Text>
                {item.row.pinned && (
                  <ActionIcon
                    icon={PinIcon}
                    size={12}
                    style={{ opacity: 0.5, pointerEvents: 'none' }}
                  />
                )}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuScrollViewport>
      )}
    </AsyncBoundary>
  );
});

export default AgentList;
