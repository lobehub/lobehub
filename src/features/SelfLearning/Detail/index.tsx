'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, useTheme } from 'antd-style';
import { ChevronLeftIcon, GraduationCapIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';

import { runsToRatio, useExpertiseDomain, useExpertiseLessons } from '../hooks';
import LayerCoverage from '../LayerCoverage';
import RuleList from '../RuleList';
import FitCurve from './FitCurve';

const styles = createStaticStyles(({ css }) => ({
  back: css`
    cursor: pointer;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  body: css`
    overflow-y: auto;
    display: flex;
  `,
  sentence: css`
    font-size: 26px;
    font-weight: 700;
    line-height: 1.5;
  `,
}));

/** plateauKind 是 DB 的开放字符串，映射成受控的 i18n key 再翻译。 */
const PLATEAU_KEY: Record<
  string,
  'plateau.growing' | 'plateau.noisy' | 'plateau.saturated' | 'plateau.stalled'
> = {
  growing: 'plateau.growing',
  noisy: 'plateau.noisy',
  saturated: 'plateau.saturated',
  stalled: 'plateau.stalled',
};

/** 副标题末尾那半句：把曲线形态说成人话，而不是把 plateauKind 直接印出来。 */
const SHAPE_CLAUSE: Record<
  string,
  | 'detail.shapeClause.growing'
  | 'detail.shapeClause.noisy'
  | 'detail.shapeClause.saturated'
  | 'detail.shapeClause.stalled'
> = {
  growing: 'detail.shapeClause.growing',
  noisy: 'detail.shapeClause.noisy',
  saturated: 'detail.shapeClause.saturated',
  stalled: 'detail.shapeClause.stalled',
};

const DomainDetail = memo(() => {
  const { t } = useTranslation('selfLearning');
  const theme = useTheme();
  const params = useParams();
  const navigate = useWorkspaceAwareNavigate();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const domainId = params.domainId;

  const { data, error, isLoading, mutate } = useExpertiseDomain(domainId);
  const { data: lessons } = useExpertiseLessons(domainId);

  const maturity = data?.maturity;
  const anchored = !!data?.domain.anchorChosenAt;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        styles={{ left: { paddingInlineStart: 24 } }}
        left={
          activeAgentId ? (
            <AgentBreadcrumb agentId={activeAgentId} title={data?.domain.title ?? t('title')} />
          ) : null
        }
      />
      <Flexbox className={styles.body} flex={1} width={'100%'}>
        <WideScreenContainer>
          <AsyncBoundary
            data={data}
            error={error}
            errorVariant={'page'}
            isLoading={isLoading}
            loading={<Loading debugId="SelfLearningDomain" />}
            onRetry={() => mutate()}
          >
            {data && (
              <Flexbox gap={24} paddingBlock={'26px 64px'}>
                <Flexbox horizontal align={'baseline'} justify={'space-between'} wrap={'wrap'}>
                  <Flexbox
                    horizontal
                    align={'center'}
                    className={styles.back}
                    gap={7}
                    onClick={() =>
                      activeAgentId && navigate(urlJoin('/agent', activeAgentId, 'self-learning'))
                    }
                  >
                    <Icon icon={ChevronLeftIcon} size={14} />
                    <Icon icon={GraduationCapIcon} size={16} />
                    <Text fontSize={13} weight={600}>
                      {t('title')} · {data.domain.title}
                    </Text>
                  </Flexbox>
                  <Text fontSize={12} type={'secondary'}>
                    {t('detail.totals', {
                      hits: data.lessonStats.hits,
                      lessons: data.lessonStats.total,
                      runs: data.runCount,
                    })}
                  </Text>
                </Flexbox>

                {anchored ? (
                  <>
                    <Text className={styles.sentence}>
                      {t('detail.headline', {
                        lessons: data.lessonStats.total,
                        runs: data.runCount,
                      })}
                      <br />
                      <Text className={styles.sentence} type={'secondary'}>
                        {maturity?.usable
                          ? t('detail.subheadOk', {
                              ceiling: Math.round(maturity.pInf ?? 0),
                              shape: t(SHAPE_CLAUSE[maturity.plateauKind ?? 'growing']),
                            })
                          : t('detail.subheadUnusable')}
                      </Text>
                    </Text>

                    <Block gap={10} padding={16} variant={'outlined'}>
                      <Flexbox
                        horizontal
                        align={'baseline'}
                        justify={'space-between'}
                        wrap={'wrap'}
                      >
                        <Text fontSize={13} weight={600}>
                          {t('detail.chart.title')}
                        </Text>
                        <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
                          <Flexbox horizontal align={'center'} gap={5}>
                            <div style={{ background: theme.colorSuccess, height: 3, width: 14 }} />
                            <Text fontSize={11} type={'secondary'}>
                              {t('detail.chart.legendActual')}
                            </Text>
                          </Flexbox>
                          <Flexbox horizontal align={'center'} gap={5}>
                            <div
                              style={{
                                borderTop: `2px dashed ${theme.colorSuccess}`,
                                height: 0,
                                width: 14,
                              }}
                            />
                            <Text fontSize={11} type={'secondary'}>
                              {t('detail.chart.legendFit')}
                            </Text>
                          </Flexbox>
                          <Flexbox horizontal align={'center'} gap={5}>
                            <div
                              style={{ background: theme.colorFillSecondary, height: 8, width: 6 }}
                            />
                            <div
                              style={{ background: theme.colorInfoBorder, height: 8, width: 6 }}
                            />
                            <Text fontSize={11} type={'secondary'}>
                              {t('detail.chart.legendBars')}
                            </Text>
                          </Flexbox>
                        </Flexbox>
                      </Flexbox>
                      <FitCurve
                        maturity={data.maturity}
                        runCount={data.runCount}
                        series={data.series}
                      />
                      <FitNote detail={data} />
                    </Block>

                    <FitMetrics detail={data} />

                    <Flexbox horizontal gap={16} wrap={'wrap'}>
                      <Flexbox gap={0} style={{ flex: 1, minWidth: 330 }}>
                        <LayerCoverage detail={data} />
                      </Flexbox>
                      <Flexbox gap={0} style={{ flex: 1, minWidth: 330 }}>
                        <RuleList lessons={lessons ?? []} stats={data.lessonStats} />
                      </Flexbox>
                    </Flexbox>

                    <Block gap={7} padding={16} variant={'outlined'}>
                      <Text fontSize={13} weight={600}>
                        {t('detail.anchorTitle')}
                      </Text>
                      <Text fontSize={12.5} lineHeight={1.75}>
                        <Text as={'span'} weight={600}>
                          {t('detail.domainFilter')}
                        </Text>
                        {data.domain.domainFilter}
                      </Text>
                      {data.domain.outOfScope && (
                        <Text fontSize={12.5} lineHeight={1.75} type={'secondary'}>
                          <Text as={'span'} weight={600}>
                            {t('detail.outOfScope')}
                          </Text>
                          {data.domain.outOfScope}
                        </Text>
                      )}
                    </Block>
                  </>
                ) : (
                  <Block gap={8} padding={20} variant={'outlined'}>
                    <Text weight={600}>{t('anchor.pending')}</Text>
                    <Text fontSize={13} type={'secondary'}>
                      {t('anchor.pendingDesc')}
                    </Text>
                  </Block>
                )}
              </Flexbox>
            )}
          </AsyncBoundary>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

/** 图下那一行：可信就说还要练多少次，不可信就说为什么不外推。 */
const FitNote = memo<{ detail: NonNullable<ReturnType<typeof useExpertiseDomain>['data']> }>(
  ({ detail }) => {
    const { t } = useTranslation('selfLearning');
    const m = detail.maturity;

    if (!m.usable) {
      return (
        <Text fontSize={11.5} lineHeight={1.7} type={'secondary'}>
          {t('detail.chart.noProjection', { reason: t(`maturity.reason.${m.reason}`) })}
        </Text>
      );
    }
    const n90 = runsToRatio(m.tau ?? 1, 0.9);
    const n95 = runsToRatio(m.tau ?? 1, 0.95);
    return (
      <Text fontSize={11.5} lineHeight={1.7} type={m.speculative ? 'warning' : 'secondary'}>
        {m.speculative
          ? t('detail.chart.speculative', {
              n90,
              span: (m.observedSpan ?? 0).toFixed(2),
              tau: Math.round(m.tau ?? 0),
            })
          : t('detail.chart.trustworthy', {
              n90,
              n95,
              remaining: Math.max(0, n90 - detail.runCount),
              span: (m.observedSpan ?? 0).toFixed(1),
            })}
      </Text>
    );
  },
);

/**
 * 四张指标卡。
 *
 * r² 和成熟度刻意并排：撞了 τ 上界的那几组回测 r² 同样漂亮 —— 贴合的是直线段。
 * 把「拟合得好」和「外推可信」分开摆出来，读的人才不会把前者当成后者。
 */
const FitMetrics = memo<{ detail: NonNullable<ReturnType<typeof useExpertiseDomain>['data']> }>(
  ({ detail }) => {
    const { t } = useTranslation('selfLearning');
    const m = detail.maturity;
    const cards: [string, string, string][] = [
      [
        t('detail.metric.maturity'),
        m.usable ? `${Math.round((m.maturity ?? 0) * 100)}%` : t('detail.metric.cannot'),
        m.usable
          ? t('detail.metric.maturitySub', {
              ceiling: Math.round(m.pInf ?? 0),
              learned: detail.lessonStats.total,
            })
          : t(`maturity.reason.${m.reason}`),
      ],
      [
        t('detail.metric.rate'),
        m.usable && m.tau ? (1 / m.tau).toFixed(3) : '—',
        m.usable && m.tau ? t('detail.metric.rateSub', { tau: Math.round(m.tau) }) : '—',
      ],
      [
        t('detail.metric.r2'),
        m.usable && m.fitR2 != null ? m.fitR2.toFixed(3) : '—',
        m.usable && m.fitSampleSize ? t('detail.metric.r2Sub', { count: m.fitSampleSize }) : '—',
      ],
      [
        t('detail.metric.shape'),
        m.usable && m.plateauKind ? t(PLATEAU_KEY[m.plateauKind] ?? 'plateau.noisy') : '—',
        t('detail.metric.shapeSub', { count: detail.tailGain }),
      ],
    ];

    return (
      <Flexbox horizontal gap={12} wrap={'wrap'}>
        {cards.map(([label, value, sub]) => (
          <Block
            gap={3}
            key={label}
            padding={16}
            style={{ flex: 1, minWidth: 190 }}
            variant={'outlined'}
          >
            <Text fontSize={11} type={'secondary'}>
              {label}
            </Text>
            <Text fontSize={22} weight={700}>
              {value}
            </Text>
            <Text fontSize={11} type={'secondary'}>
              {sub}
            </Text>
          </Block>
        ))}
      </Flexbox>
    );
  },
);

FitNote.displayName = 'FitNote';
FitMetrics.displayName = 'FitMetrics';
DomainDetail.displayName = 'DomainDetail';

export default DomainDetail;
