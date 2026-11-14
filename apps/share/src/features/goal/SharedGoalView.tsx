'use client';

import { Flexbox, Skeleton, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import useSWR from 'swr';

import ReportChapters from '@/features/AgentGoals/Report/ReportChapters';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

import { clientOnly } from '../../shell/clientOnly';
import ShareLayout from '../../shell/ShareLayout';
import SharedGoalAcceptance from './SharedGoalAcceptance';
import type { SharedGoalData } from './sharedGoalTypes';

const SharedGoalGraph = clientOnly(() => import('./SharedGoalGraph.client'));

const GOAL_READER_WIDTH = 960;
const GRAPH_HEIGHT = 560;

const styles = stylex.create({
  // A floating share header sits over the scroll content, so the page pads by
  // the overlap ShareLayout publishes (0 once the header becomes a bar).
  column: {
    marginInline: 'auto',
    paddingBlockEnd: 64,
    paddingBlockStart: 'calc(var(--share-header-overlap, 0px) + 32px)',
    paddingInline: 24,
    width: `min(${GOAL_READER_WIDTH}px, 100%)`,
  },
  page: {
    flex: '1',
    minHeight: 0,
    overflowY: 'auto',
  },
});

const statusKey = (status: SharedGoalData['goal']['status']) =>
  `goalList.status.${status === 'failed' ? 'error' : status}` as const;

const Section = ({ children, title }: { children: ReactNode; title: string }) => (
  <Flexbox gap={16}>
    <Text fontSize={20} weight={600}>
      {title}
    </Text>
    {children}
  </Flexbox>
);

const GraphSkeleton = () => <Skeleton height={GRAPH_HEIGHT} radius={8} width={'100%'} />;

const Content = memo<{ view: SharedGoalData }>(({ view }) => {
  const { t } = useTranslation('chat');
  const { report } = view;
  const hasGraph = view.nodes.length > 0;
  const hasAcceptance = !!view.acceptance || view.nodes.some((node) => node.acceptance);

  return (
    <Flexbox gap={40} {...stylex.props(styles.column)}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Tag>{t(statusKey(view.goal.status))}</Tag>
          {view.visibility === 'private' && view.isOwner && (
            <Tag color={'warning'}>{t('goalShare.private.ownerOnly')}</Tag>
          )}
        </Flexbox>
        <Text fontSize={28} weight={700}>
          {report?.headline ?? view.goal.title}
        </Text>
        {report && report.headline !== view.goal.title && (
          <Text type={'secondary'}>{view.goal.title}</Text>
        )}
      </Flexbox>

      {!report && !hasGraph && !hasAcceptance ? (
        <Text type={'secondary'}>{t('goalShare.empty')}</Text>
      ) : (
        <>
          {report && (
            <Section title={t('goalShare.report.title')}>
              <ReportChapters chapters={report.chapters} />
              {report.nextSteps.length > 0 && (
                <Flexbox gap={8}>
                  <Text weight={600}>{t('goalShare.nextSteps.title')}</Text>
                  {report.nextSteps.map((step, index) => (
                    <Flexbox gap={2} key={index}>
                      <Text weight={500}>{step.title}</Text>
                      <Text fontSize={13} type={'secondary'}>
                        {step.reason}
                      </Text>
                    </Flexbox>
                  ))}
                </Flexbox>
              )}
            </Section>
          )}
          {hasGraph && <SharedGoalGraph fallback={<GraphSkeleton />} view={view} />}
          <SharedGoalAcceptance view={view} />
        </>
      )}
    </Flexbox>
  );
});

Content.displayName = 'SharedGoalContent';

const SharedGoalView = memo(() => {
  const { id } = useParams<{ id: string }>();

  const { data, error, isLoading } = useSWR(
    id ? shareKeys.goal(id) : null,
    async () => (await lambdaClient.goalShare.getSharedGoal.query({ shareId: id! })).data,
    { revalidateOnFocus: false },
  );

  return (
    <ShareLayout
      contentWidth={GOAL_READER_WIDTH}
      error={error}
      // The SSR document already carries the goal, and SWR revalidates on mount
      // with it in cache — gating on `isLoading` alone would blank it.
      loading={isLoading && !data}
      title={data?.goal.title}
    >
      {data ? (
        <div {...stylex.props(styles.page)}>
          <Content view={data} />
        </div>
      ) : null}
    </ShareLayout>
  );
});

SharedGoalView.displayName = 'SharedGoalView';

export default SharedGoalView;
