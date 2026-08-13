'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, useTheme } from 'antd-style';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';

import CoverageCloud from '../CoverageCloud';
import { runsToRatio, useExpertiseDomain, useExpertiseLessons } from '../hooks';
import RuleList from '../RuleList';
import FitCurve from './FitCurve';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    display: flex;
  `,
  sentence: css`
    font-size: 26px;
    font-weight: 700;
    line-height: 1.5;
  `,
  learningGrid: css`
    display: grid;
    grid-template-columns: minmax(280px, 0.72fr) minmax(420px, 1.28fr);
    gap: 16px;
    align-items: start;

    @media (width <= 960px) {
      grid-template-columns: 1fr;
    }
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
  const navigate = useNavigate();
  const params = useParams();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const domainId = params.domainId;

  const { data, error, isLoading, mutate } = useExpertiseDomain(domainId);
  const {
    data: lessons,
    error: lessonsError,
    isLoading: lessonsLoading,
    mutate: mutateLessons,
  } = useExpertiseLessons(domainId);

  const maturity = data?.maturity;
  const selfLearningPath = activeAgentId
    ? urlJoin('/agent', activeAgentId, 'self-learning')
    : undefined;
  const rulesPath =
    selfLearningPath && domainId ? urlJoin(selfLearningPath, domainId, 'rules') : '';

  useEffect(() => {
    if (!isLoading && !error && !data && selfLearningPath) {
      navigate(selfLearningPath, { replace: true });
    }
  }, [data, error, isLoading, navigate, selfLearningPath]);

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        styles={{ left: { paddingInlineStart: 24 } }}
        left={
          activeAgentId ? (
            <AgentBreadcrumb
              agentId={activeAgentId}
              extraItems={data?.domain.title ? [data.domain.title] : undefined}
              title={
                <Link to={selfLearningPath ?? '#'}>
                  <Text as={'span'} color={'inherit'} weight={500}>
                    {t('title')}
                  </Text>
                </Link>
              }
            />
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
                {data.runCount === 0 ? (
                  /* 刚定完方向、一次还没练过：画不出曲线，坐标轴会退化成一排「1 条」。
                     这时候该说的是下一步做什么，而不是摆一张空图。 */
                  <Block gap={8} padding={20} variant={'outlined'}>
                    <Text weight={600}>{t('detail.notPractised')}</Text>
                    <Text fontSize={13} lineHeight={1.7} type={'secondary'}>
                      {t('detail.notPractisedDesc')}
                    </Text>
                    <Text fontSize={12.5} lineHeight={1.75} type={'secondary'}>
                      <Text as={'span'} weight={600}>
                        {t('detail.domainFilter')}
                      </Text>
                      {data.domain.domainFilter}
                    </Text>
                  </Block>
                ) : (
                  <>
                    <Text className={styles.sentence}>
                      {t('detail.learningSummary', {
                        lessons: data.lessonStats.total,
                      })}
                      <br />
                      <Text className={styles.sentence} type={'secondary'}>
                        {t('detail.practiceSummary', {
                          hits: data.lessonStats.hits,
                          runs: data.runCount,
                        })}
                      </Text>
                    </Text>

                    <Text fontSize={13} type={'secondary'}>
                      {maturity?.usable
                        ? t('detail.subheadOk', {
                            ceiling: Math.round(maturity.pInf ?? 0),
                            shape: t(SHAPE_CLAUSE[maturity.plateauKind ?? 'growing']),
                          })
                        : t('detail.subheadUnusable')}
                    </Text>

                    <Block gap={10} padding={16} variant={'outlined'}>
                      <Flexbox
                        horizontal
                        align={'baseline'}
                        justify={'space-between'}
                        wrap={'wrap'}
                      >
                        <Flexbox gap={3} style={{ flex: 1, minWidth: 260 }}>
                          <Text fontSize={13} weight={600}>
                            {t('detail.chart.title')}
                          </Text>
                          <FitNote detail={data} />
                        </Flexbox>
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
                    </Block>

                    <FitMetrics detail={data} />

                    <div className={styles.learningGrid}>
                      <CoverageCloud detail={data} />
                      <AsyncBoundary
                        data={lessons}
                        error={lessonsError}
                        isLoading={lessonsLoading}
                        loading={<Loading debugId={'SelfLearningDomainRules'} />}
                        onRetry={() => mutateLessons()}
                      >
                        {lessons && (
                          <RuleList
                            compact
                            lessonHref={(lessonId) => urlJoin(rulesPath, lessonId)}
                            lessons={lessons}
                            stats={data.lessonStats}
                            viewAllHref={rulesPath}
                          />
                        )}
                      </AsyncBoundary>
                    </div>

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
    if (!m.usable && detail.runCount > 0) return null;
    // 算不出的时候只留成熟度那张（它承载「为什么算不出」），其余三张整块不渲染。
    // 一排「—」既没有信息又占掉整行，读起来像是坏了而不是「这次没算出来」。
    const cards: [string, string, string][] = m.usable
      ? [
          [
            t('detail.metric.maturity'),
            `${Math.round((m.maturity ?? 0) * 100)}%`,
            t('detail.metric.maturitySub', {
              ceiling: Math.round(m.pInf ?? 0),
              learned: detail.lessonStats.total,
            }),
          ],
          [
            t('detail.metric.rate'),
            m.tau ? (1 / m.tau).toFixed(3) : '—',
            m.tau ? t('detail.metric.rateSub', { tau: Math.round(m.tau) }) : '—',
          ],
          [
            t('detail.metric.r2'),
            m.fitR2 == null ? '—' : m.fitR2.toFixed(3),
            m.fitSampleSize ? t('detail.metric.r2Sub', { count: m.fitSampleSize }) : '—',
          ],
          [
            t('detail.metric.shape'),
            m.plateauKind ? t(PLATEAU_KEY[m.plateauKind] ?? 'plateau.noisy') : '—',
            t('detail.metric.shapeSub', { count: detail.tailGain }),
          ],
        ]
      : [
          [
            t('detail.metric.maturity'),
            t('detail.metric.cannot'),
            t(`maturity.reason.${m.reason}`),
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
