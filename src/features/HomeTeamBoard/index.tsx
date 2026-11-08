import type { AgentRunBoardWindowHours } from '@lobechat/types';
import { Flexbox, Segmented, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useClientPollingSWR } from '@/libs/swr';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { agentRunBoardService } from '@/services/agentRunBoard';

import ActivityPanel from './ActivityPanel';
import AttentionList from './AttentionList';
import DayCalendar from './DayCalendar';
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

  const { data, error, mutate } = useClientPollingSWR(
    ['agentRunBoard', cacheScope, windowHours],
    () => agentRunBoardService.get(windowHours),
    {
      // The polling default dedupes for 30s, which would swallow every other tick.
      dedupingInterval: POLL_INTERVAL / 2,
      keepPreviousData: true,
      refreshInterval: POLL_INTERVAL,
      revalidateOnFocus: true,
    },
  );

  if (error && !data) return <AsyncError error={error} variant={'inline'} onRetry={mutate} />;

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
              <Segmented
                size={'small'}
                value={String(windowHours)}
                options={WINDOW_OPTIONS.map((value) => ({
                  label: t('team.window', { count: value }),
                  value: String(value),
                }))}
                onChange={(value) => setWindowHours(Number(value) as AgentRunBoardWindowHours)}
              />
            }
          />
          <div {...stylex.props(styles.columns)}>
            {!data.lanes?.length ? (
              <div {...stylex.props(styles.empty)}>{t('team.empty', { count: windowHours })}</div>
            ) : windowHours === 24 ? (
              <DayCalendar board={data} />
            ) : (
              <Timeline board={data} />
            )}
            <AttentionList items={data.attention} now={data.generatedAt} />
          </div>
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default HomeTeamBoard;
