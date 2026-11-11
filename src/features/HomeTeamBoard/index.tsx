import type { AgentRunBoardScope, AgentRunBoardWindowHours } from '@lobechat/types';
import { Flexbox, Segmented, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useClientPollingSWR } from '@/libs/swr';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { agentRunBoardService } from '@/services/agentRunBoard';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import ActivityPanel from './ActivityPanel';
import AttentionList from './AttentionList';
import BoardFilters from './BoardFilters';
import DayCalendar from './DayCalendar';
import QuotaCapacity from './QuotaCapacity';
import Timeline from './Timeline';

// Matches the other overview pages; the gateway only streams a user's own runs.
const POLL_INTERVAL = 15_000;
const WINDOW_OPTIONS: AgentRunBoardWindowHours[] = [1, 6, 24];

const styles = stylex.create({
  // Clears the floating Home tabs above.
  root: { paddingBlockStart: 24 },
  columns: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: {
      'default': 'minmax(0, 1fr) 340px',
      '@media (max-width: 1100px)': 'minmax(0, 1fr)',
    },
    alignItems: 'start',
  },
  columnsFolded: {
    gridTemplateColumns: {
      'default': 'minmax(0, 1fr) 44px',
      '@media (max-width: 1100px)': 'minmax(0, 1fr)',
    },
  },
  columnsFull: { gridTemplateColumns: 'minmax(0, 1fr)' },
  empty: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    color: cssVar.colorTextTertiary,
    fontSize: 14,
    paddingBlock: 48,
    paddingInline: 16,
    textAlign: 'center',
  },
});

const HomeTeamBoard = () => {
  const { t } = useTranslation('home');
  const cacheScope = useCacheScope();
  const [windowHours, setWindowHours] = useState<AgentRunBoardWindowHours>(1);
  const [scope, setScope] = useState<AgentRunBoardScope>('all');
  const [agentId, setAgentId] = useState<string>();
  const [userId, setUserId] = useState<string>();
  const attentionCollapsed = useGlobalStore(systemStatusSelectors.teamBoardAttentionCollapsed);

  // The options depend on the scope and window, so a pick may not exist in the next one.
  const clearPicks = () => {
    setAgentId(undefined);
    setUserId(undefined);
  };

  const { data, error, mutate } = useClientPollingSWR(
    ['agentRunBoard', cacheScope, windowHours, scope, agentId, userId],
    () => agentRunBoardService.get({ agentId, scope, userId, windowHours }),
    {
      // The polling default dedupes for 30s, which would swallow every other tick.
      dedupingInterval: POLL_INTERVAL / 2,
      keepPreviousData: true,
      refreshInterval: POLL_INTERVAL,
      revalidateOnFocus: true,
    },
  );

  if (error && !data) return <AsyncError error={error} variant={'inline'} onRetry={mutate} />;

  // An older server can omit the field; the board must still render.
  const attention = data?.attention ?? [];
  const hasAttention = attention.length > 0;

  return (
    <Flexbox data-testid={'team-board'} gap={20} {...stylex.props(styles.root)}>
      {!data ? (
        <Skeleton height={420} width={'100%'} />
      ) : (
        <Flexbox gap={16}>
          <ActivityPanel
            activity={data.activity}
            summary={data.summary}
            action={
              <Flexbox horizontal gap={8} wrap={'wrap'}>
                <Segmented
                  size={'small'}
                  value={scope}
                  options={[
                    { label: t('team.scope.all'), value: 'all' },
                    { label: t('team.scope.involved'), value: 'involved' },
                  ]}
                  onChange={(value) => {
                    setScope(value as AgentRunBoardScope);
                    clearPicks();
                  }}
                />
                <Segmented
                  size={'small'}
                  value={String(windowHours)}
                  options={WINDOW_OPTIONS.map((value) => ({
                    label: t('team.window', { count: value }),
                    value: String(value),
                  }))}
                  onChange={(value) => {
                    setWindowHours(Number(value) as AgentRunBoardWindowHours);
                    clearPicks();
                  }}
                />
              </Flexbox>
            }
          />
          <BoardFilters
            agentId={agentId}
            options={data.filterOptions}
            userId={userId}
            onAgentChange={setAgentId}
            onUserChange={setUserId}
          />
          <div
            {...stylex.props(
              styles.columns,
              attentionCollapsed && styles.columnsFolded,
              !hasAttention && styles.columnsFull,
            )}
          >
            {!data.lanes?.length ? (
              <div {...stylex.props(styles.empty)}>
                {t(scope === 'involved' ? 'team.emptyInvolved' : 'team.empty', {
                  count: windowHours,
                })}
              </div>
            ) : windowHours === 24 ? (
              <DayCalendar board={data} />
            ) : (
              <Timeline board={data} />
            )}
            {hasAttention && <AttentionList items={attention} now={data.generatedAt} />}
          </div>
        </Flexbox>
      )}
      {/* Independent of the run board: it loads, polls and fails on its own. */}
      <QuotaCapacity />
    </Flexbox>
  );
};

export default HomeTeamBoard;
