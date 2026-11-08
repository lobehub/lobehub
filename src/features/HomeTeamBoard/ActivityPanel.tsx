import type {
  AgentRunBoardActivityBucket,
  AgentRunBoardRunStatus,
  AgentRunBoardSummary,
} from '@lobechat/types';
import { BarChart } from '@lobehub/charts';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { extendActivityWithFuture } from './layout';
import { RUN_STATUS_VISUALS } from './statusVisuals';

const styles = stylex.create({
  card: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    paddingBlock: 20,
    paddingInline: 20,
  },
  label: { color: cssVar.colorTextSecondary, fontSize: 13 },
  value: {
    color: cssVar.colorText,
    fontSize: 24,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    lineHeight: 1.2,
  },
});

const STATS: { key: keyof AgentRunBoardSummary; status: AgentRunBoardRunStatus }[] = [
  { key: 'running', status: 'running' },
  { key: 'needsHuman', status: 'needs_human' },
  { key: 'failed', status: 'failed' },
  { key: 'done', status: 'done' },
];

interface ActivityPanelProps {
  action: ReactNode;
  activity: AgentRunBoardActivityBucket[];
  summary: AgentRunBoardSummary;
}

/** The numbers double as the chart's legend: each one carries its series' icon and color. */
const ActivityPanel = ({ action, activity, summary }: ActivityPanelProps) => {
  const { t } = useTranslation('home');
  const series = STATS.map((stat) => ({
    ...stat,
    color: RUN_STATUS_VISUALS[stat.status].color,
    label: t(`team.summary.${stat.key}`),
  }));

  const data = extendActivityWithFuture(activity).map((bucket) => ({
    ...Object.fromEntries(series.map(({ key, label }) => [label, bucket[key]])),
    time: dayjs(bucket.startedAt).format('HH:mm'),
  }));

  return (
    <Flexbox gap={16} {...stylex.props(styles.card)} data-testid={'team-board-activity'}>
      <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'} wrap={'wrap'}>
        <Flexbox horizontal gap={40} wrap={'wrap'}>
          {series.map(({ color, key, label, status }) => (
            <Flexbox gap={4} key={key}>
              <Flexbox horizontal align={'center'} gap={6}>
                <Icon color={color} icon={RUN_STATUS_VISUALS[status].icon} size={14} />
                <span {...stylex.props(styles.label)}>{label}</span>
              </Flexbox>
              <span {...stylex.props(styles.value)} data-testid={`team-board-count-${key}`}>
                {summary[key]}
              </span>
            </Flexbox>
          ))}
        </Flexbox>
        {action}
      </Flexbox>
      <BarChart
        stack
        allowDecimals={false}
        categories={series.map(({ label }) => label)}
        colors={series.map(({ color }) => color)}
        data={data}
        height={120}
        index={'time'}
        showLegend={false}
      />
    </Flexbox>
  );
};

export default ActivityPanel;
