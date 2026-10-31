'use client';

import { agentDisplayName } from '@lobechat/types';
import {
  Block,
  Button,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  Input,
  Popover,
  Text,
} from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { CheckIcon, ChevronDownIcon, UsersIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import { isInboxAgentId } from '@/features/AgentTasks/shared/isInboxAgent';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import type { GoalAgentFilterOption } from './goalAgentFilterOptions';
import { matchGoalAgentFilterOptions } from './goalAgentFilterOptions';

const styles = createStaticStyles(({ css }) => ({
  search: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

/**
 * Display names of the filter's agents, resolved the way the rest of the goal
 * UI names them: the visited agent's own meta, else the sidebar's copy — the
 * search has to match what each row reads.
 */
const useAgentTitles = (agentIds: string[]): Record<string, string> => {
  const { t } = useTranslation(['chat', 'common']);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const metaTitles = useAgentStore(
    (s) => agentIds.map((id) => agentDisplayName(agentSelectors.getAgentMetaById(id)(s))),
    isEqual,
  );
  const sidebarTitles = useHomeStore(
    (s) => agentIds.map((id) => agentDisplayName(homeAgentListSelectors.getAgentById(id)(s))),
    isEqual,
  );

  return useMemo(
    () =>
      Object.fromEntries(
        agentIds.map((id, index) => [
          id,
          metaTitles[index] ||
            sidebarTitles[index] ||
            (isInboxAgentId(id, inboxAgentId)
              ? t('inbox.title', { ns: 'chat' })
              : t('defaultSession', { ns: 'common' })),
        ]),
      ),
    [agentIds, inboxAgentId, metaTitles, sidebarTitles, t],
  );
};

interface FilterRowProps {
  active: boolean;
  count?: number;
  icon: React.ReactNode;
  onSelect: () => void;
  selected: boolean;
  title: string;
}

const FilterRow = ({ active, count, icon, onSelect, selected, title }: FilterRowProps) => (
  <Block
    clickable
    horizontal
    align={'center'}
    gap={8}
    paddingBlock={6}
    paddingInline={8}
    variant={active ? 'filled' : 'borderless'}
    onClick={onSelect}
  >
    {icon}
    <Text ellipsis style={{ flex: 1 }}>
      {title}
    </Text>
    {selected ? (
      <Icon color={cssVar.colorTextSecondary} icon={CheckIcon} size={14} />
    ) : (
      count !== undefined && (
        <Text fontSize={12} type={'secondary'}>
          {count}
        </Text>
      )
    )}
  </Block>
);

interface GoalAgentFilterProps {
  onChange: (agentId?: string) => void;
  options: GoalAgentFilterOption[];
  value?: string;
}

/**
 * Narrows the cross-agent goals page to one agent's goals, the way an agent's
 * own Goals page would show them, without leaving the workspace. Searchable,
 * since a workspace can hold far more agents than a menu can scan.
 */
const GoalAgentFilter = memo<GoalAgentFilterProps>(({ onChange, options, value }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const agentIds = useMemo(
    () => [...new Set([...options.map((option) => option.agentId), ...(value ? [value] : [])])],
    [options, value],
  );
  const titles = useAgentTitles(agentIds);
  const query = search.trim();
  const matches = useMemo(
    () => matchGoalAgentFilterOptions(options, titles, query),
    [options, query, titles],
  );
  // The "all agents" row is the way back from a narrowed list; while searching
  // for a specific agent it is noise, so it only leads the unfiltered menu.
  const rows: Array<GoalAgentFilterOption | undefined> = query ? matches : [undefined, ...matches];

  const select = (agentId?: string) => {
    onChange(agentId);
    setOpen(false);
    setSearch('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (rows.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % rows.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      select(rows[Math.min(activeIndex, rows.length - 1)]?.agentId);
    }
  };

  return (
    <Popover
      open={open}
      placement={'bottomRight'}
      styles={{ content: { padding: 0, width: 260 } }}
      trigger={'click'}
      content={
        <Flexbox>
          <Input
            autoFocus
            className={styles.search}
            placeholder={t('taskList.assigneeSearch.agentPlaceholder')}
            value={search}
            variant={'borderless'}
            onKeyDown={handleKeyDown}
            onChange={(event) => {
              setSearch(event.target.value);
              setActiveIndex(0);
            }}
          />
          {rows.length === 0 ? (
            <Flexbox align={'center'} justify={'center'} padding={16}>
              <Text fontSize={12} type={'secondary'}>
                {t('taskList.assigneeSearch.agentEmpty')}
              </Text>
            </Flexbox>
          ) : (
            <Flexbox gap={2} padding={6} style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {rows.map((option, index) =>
                option ? (
                  <FilterRow
                    active={index === activeIndex}
                    count={option.count}
                    icon={<AssigneeAvatar agentId={option.agentId} size={20} />}
                    key={option.agentId}
                    selected={option.agentId === value}
                    title={titles[option.agentId]}
                    onSelect={() => select(option.agentId)}
                  />
                ) : (
                  <FilterRow
                    active={index === activeIndex}
                    icon={<Icon color={cssVar.colorTextSecondary} icon={UsersIcon} size={18} />}
                    key={'all'}
                    selected={!value}
                    title={t('goalPage.agentFilter.all')}
                    onSelect={() => select(undefined)}
                  />
                ),
              )}
            </Flexbox>
          )}
        </Flexbox>
      }
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
        setActiveIndex(0);
      }}
    >
      <Button
        icon={value ? <AssigneeAvatar agentId={value} size={16} /> : <Icon icon={UsersIcon} />}
        size={'small'}
        // Stretch to the toolbar row, so it stands as tall as the status
        // Segmented beside it instead of a size step shorter.
        style={{ alignSelf: 'stretch', height: 'auto' }}
        title={t('goalPage.agentFilter.title')}
      >
        {value ? titles[value] : t('goalPage.agentFilter.all')}
        <Icon icon={ChevronDownIcon} size={14} />
      </Button>
    </Popover>
  );
});

GoalAgentFilter.displayName = 'GoalAgentFilter';

export default GoalAgentFilter;
