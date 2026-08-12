'use client';

import { Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useTheme } from 'antd-style';
import { ChevronLeftIcon, GraduationCapIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { expertiseService } from '@/services/expertise';
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
  const selfLearningPath = activeAgentId
    ? urlJoin('/agent', activeAgentId, 'self-learning')
    : undefined;

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
                <Flexbox horizontal align={'baseline'} justify={'space-between'} wrap={'wrap'}>
                  <Flexbox
                    horizontal
                    align={'center'}
                    className={styles.back}
                    gap={7}
                    onClick={() => selfLearningPath && navigate(selfLearningPath)}
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

                {anchored && data.runCount === 0 ? (
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
                ) : anchored ? (
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
                  <AnchorChoice detail={data} onChosen={() => mutate()} />
                )}
              </Flexbox>
            )}
          </AsyncBoundary>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

/**
 * 锚点未定时的那一屏。
 *
 * 上一轮验收的原话是「这里缺少可行的 action？」—— 说得对：文案写着「等你先定一个方向」，
 * 却没有任何地方能定。锚定阶段读出来的候选本来就存在 anchorCandidates 里，
 * 这里把它们摆出来让人点。没选的那条**不删**，半年后还要能回答「当时选另一个会怎样」。
 */
const AnchorChoice = memo<{
  detail: NonNullable<ReturnType<typeof useExpertiseDomain>['data']>;
  onChosen: () => void;
}>(({ detail, onChosen }) => {
  const { t } = useTranslation('selfLearning');
  const [pending, setPending] = useState<string>();
  const candidates = detail.domain.anchorCandidates ?? [];

  const choose = async (key: string) => {
    setPending(key);
    try {
      await expertiseService.chooseAnchor(detail.domain.id, key);
      onChosen();
    } catch {
      toast.error(t('anchor.chooseFailed'));
    } finally {
      setPending(undefined);
    }
  };

  return (
    <Flexbox gap={12}>
      <Block gap={8} padding={20} variant={'outlined'}>
        <Text weight={600}>{t('anchor.pending')}</Text>
        <Text fontSize={13} type={'secondary'}>
          {t('anchor.pendingDesc')}
        </Text>
      </Block>

      {candidates.length === 0 ? (
        <Block gap={6} padding={20} variant={'filled'}>
          <Text fontSize={13} weight={600}>
            {t('anchor.noCandidates')}
          </Text>
          <Text fontSize={12} lineHeight={1.7} type={'secondary'}>
            {t('anchor.noCandidatesDesc')}
          </Text>
        </Block>
      ) : (
        candidates.map((c) => (
          <Block gap={10} key={c.key} padding={20} variant={'outlined'}>
            <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'}>
              <Flexbox gap={4} style={{ flex: 1, minWidth: 0 }}>
                <Text fontSize={15} weight={600}>
                  {c.title}
                </Text>
                {c.rationale && (
                  <Text fontSize={12.5} lineHeight={1.7} type={'secondary'}>
                    {c.rationale}
                  </Text>
                )}
              </Flexbox>
              <Button
                disabled={!!pending}
                loading={pending === c.key}
                style={{ flex: 'none' }}
                onClick={() => choose(c.key)}
              >
                {t('anchor.choose')}
              </Button>
            </Flexbox>
            <Flexbox gap={4}>
              <Text fontSize={12} lineHeight={1.7} type={'secondary'}>
                <Text as={'span'} weight={600}>
                  {t('detail.domainFilter')}
                </Text>
                {c.domainFilter}
              </Text>
              <Flexbox horizontal gap={6} wrap={'wrap'}>
                {c.layers.map((l) => (
                  <Tag key={l.key} size={'small'}>
                    {l.title}
                  </Tag>
                ))}
              </Flexbox>
            </Flexbox>
          </Block>
        ))
      )}
    </Flexbox>
  );
});

AnchorChoice.displayName = 'AnchorChoice';

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
