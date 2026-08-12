'use client';

import { Block, Center, Empty, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useTheme } from 'antd-style';
import { ChevronRightIcon, GraduationCapIcon, PlusIcon, SparklesIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ExpertiseDomainItem } from '@/services/expertise';
import { useAgentStore } from '@/store/agent';

import { openCreateDomainModal } from './CreateDomainModal';
import Curves from './Curves';
import { type ExpertiseShape, shapeOf, useExpertiseOverview } from './hooks';
import JourneyStrip from './JourneyStrip';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    display: flex;
  `,
  insight: css`
    cursor: pointer;

    padding-block: 14px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  row: css`
    cursor: pointer;
    padding-block: 11px;
    padding-inline: 14px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  sentence: css`
    font-size: 26px;
    font-weight: 700;
    line-height: 1.5;
  `,
  swatch: css`
    width: 14px;
    height: 3px;
    border-radius: 2px;
  `,
}));

/** 线尾带标签的那几条的配色，按 focus 顺序取。 */
const FOCUS_MAX = 3;

const useShapeLabels = () => {
  const { t } = useTranslation('selfLearning');
  const theme = useTheme();
  return {
    declining: { color: theme.colorWarning, label: t('shape.declining') },
    fresh: { color: theme.colorTextQuaternary, label: t('shape.fresh') },
    flat: { color: theme.colorSuccess, label: t('shape.flat') },
    rising: { color: theme.colorInfo, label: t('shape.rising') },
    stuck: { color: theme.colorTextTertiary, label: t('shape.stuck') },
  } satisfies Record<ExpertiseShape, { color: string; label: string }>;
};

const SelfLearning = memo(() => {
  const { t } = useTranslation('selfLearning');
  const navigate = useWorkspaceAwareNavigate();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const { data, error, isLoading, mutate } = useExpertiseOverview(activeAgentId ?? undefined);
  const [hoverId, setHoverId] = useState<string>();
  const shapes = useShapeLabels();

  const domains = useMemo(() => data?.domains ?? [], [data]);
  /** 全都还没练过的时候，坐标轴会退化成一排「第 1 次」—— 那张空网格不如不画。 */
  const hasCurves = domains.some((d) => d.series.length > 1);

  const openDomain = (domainId: string) => {
    if (!activeAgentId) return;
    navigate(urlJoin('/agent', activeAgentId, 'self-learning', domainId));
  };

  /**
   * 主图只给三条线上色，其余淡成背景 —— 十个专长十条彩线就是一团糊。
   * 挑的是「练得最多」的三个：练得越多，曲线的形状越是结论而不是噪声。
   *
   * **颜色编码的是形状，不是排名。** 图例说的就是这四种形状，颜色要是按名次发的，
   * 图例就成了摆设 —— 一条被标成「掉头 = 能力在退」的黄线其实在涨，比不上色更糟。
   */
  const { colors, focusIds } = useMemo(() => {
    const ids = [...domains]
      .sort((a, b) => b.runCount - a.runCount)
      .slice(0, FOCUS_MAX)
      .map((d) => d.id);
    return {
      colors: Object.fromEntries(
        domains.map((d) => [d.id, shapes[shapeOf(d.maturity, d.delta, d.runCount)].color]),
      ),
      focusIds: ids,
    };
  }, [domains, shapes]);

  /** 一句判断句放在最前面 —— 用户先要的是结论，不是图。 */
  const headline = useMemo(() => {
    if (domains.length === 0) return null;
    const withShape = domains.map((d) => ({ d, shape: shapeOf(d.maturity, d.delta, d.runCount) }));
    const flat = withShape.find((x) => x.shape === 'flat');
    const declining = withShape.find((x) => x.shape === 'declining');
    const rising = withShape.find((x) => x.shape === 'rising');
    const lead = flat
      ? t('headline.flat', { name: flat.d.title })
      : rising
        ? t('headline.rising', { name: rising.d.title })
        : t('headline.none');
    const restParts = [
      rising && flat ? t('headline.alsoRising', { name: rising.d.title }) : null,
      declining ? t('headline.alsoDeclining', { name: declining.d.title }) : null,
    ].filter(Boolean);
    return { lead, rest: restParts.join('') };
  }, [domains, t]);

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        left={activeAgentId ? <AgentBreadcrumb agentId={activeAgentId} title={t('title')} /> : null}
        styles={{ left: { paddingInlineStart: 24 } }}
      />
      <Flexbox className={styles.body} flex={1} width={'100%'}>
        <WideScreenContainer>
          <AsyncBoundary
            data={data}
            error={error}
            errorVariant={'page'}
            isEmpty={!error && domains.length === 0}
            isLoading={isLoading}
            loading={<Loading debugId="SelfLearning" />}
            empty={
              <Center height={'100%'} style={{ minHeight: '50vh' }} width={'100%'}>
                <Flexbox align={'center'} gap={20} style={{ maxWidth: 680 }}>
                  <Empty
                    description={t('empty.desc')}
                    descriptionProps={{ fontSize: 13 }}
                    icon={GraduationCapIcon}
                    style={{ maxWidth: 420 }}
                    title={t('empty.title')}
                    action={
                      <Button
                        icon={PlusIcon}
                        type={'primary'}
                        onClick={() => {
                          if (!activeAgentId) return;
                          openCreateDomainModal({
                            agentId: activeAgentId,
                            onCreated: () => void mutate(),
                          });
                        }}
                      >
                        {t('create.entry')}
                      </Button>
                    }
                  />
                  <JourneyStrip />
                </Flexbox>
              </Center>
            }
            onRetry={() => mutate()}
          >
            <Flexbox gap={24} paddingBlock={'26px 64px'}>
              {headline && (
                <Text className={styles.sentence}>
                  {headline.lead}
                  {headline.rest && (
                    <>
                      <br />
                      <Text className={styles.sentence} type={'secondary'}>
                        {headline.rest}
                      </Text>
                    </>
                  )}
                </Text>
              )}

              {hasCurves && (
                <Block gap={10} padding={16} variant={'outlined'}>
                  <Curves
                    colors={colors}
                    domains={domains}
                    focusIds={focusIds}
                    hoverId={hoverId}
                    onHover={setHoverId}
                    onOpen={openDomain}
                  />
                  <Flexbox horizontal align={'center'} gap={14} wrap={'wrap'}>
                    {(['flat', 'rising', 'declining', 'stuck'] as ExpertiseShape[]).map((key) => (
                      <Flexbox horizontal align={'center'} gap={6} key={key}>
                        <div className={styles.swatch} style={{ background: shapes[key].color }} />
                        <Text fontSize={11.5} type={'secondary'}>
                          {shapes[key].label}
                        </Text>
                      </Flexbox>
                    ))}
                  </Flexbox>
                </Block>
              )}

              {!!data?.insights.length && (
                <Flexbox gap={10}>
                  <Flexbox horizontal align={'center'} justify={'space-between'}>
                    <Flexbox horizontal align={'center'} gap={7}>
                      <Icon icon={SparklesIcon} size={14} />
                      <Text fontSize={13} weight={600}>
                        {t('insights.title')}
                      </Text>
                    </Flexbox>
                    <Text fontSize={12.5} type={'secondary'}>
                      {t('overview.totals', {
                        domains: data.totals.domains,
                        lessons: data.totals.lessons,
                      })}
                    </Text>
                  </Flexbox>
                  {data.insights.map((it) => (
                    <Flexbox
                      className={styles.insight}
                      gap={7}
                      key={it.id}
                      onClick={() => it.domainId && openDomain(it.domainId)}
                    >
                      <Text fontSize={11.5} type={'secondary'}>
                        {it.headline}
                      </Text>
                      <Text fontSize={14.5} lineHeight={1.7}>
                        {it.body}
                      </Text>
                      {it.actionLabel && (
                        <Flexbox horizontal>
                          <Text fontSize={12.5} type={'info'}>
                            {it.actionLabel} ›
                          </Text>
                        </Flexbox>
                      )}
                    </Flexbox>
                  ))}
                </Flexbox>
              )}

              <Flexbox gap={8}>
                <Text fontSize={12} type={'secondary'}>
                  {t('overview.allDomains', { count: domains.length })}
                </Text>
                <Block padding={0} variant={'outlined'}>
                  {domains.map((domain) => (
                    <DomainRow
                      color={colors[domain.id]}
                      domain={domain}
                      key={domain.id}
                      onHover={setHoverId}
                      onOpen={openDomain}
                    />
                  ))}
                </Block>
              </Flexbox>
            </Flexbox>
          </AsyncBoundary>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

interface DomainRowProps {
  color?: string;
  domain: ExpertiseDomainItem;
  onHover: (id?: string) => void;
  onOpen: (id: string) => void;
}

/**
 * 一行一个专长，右边是它自己的累计柱。
 *
 * 柱高 = 当时的成熟度，所以**涨到顶就是满了** —— 用新增柱的话得先让人理解
 * 「柱子变矮是好事」，那是一层不必要的翻译。
 */
const DomainRow = memo<DomainRowProps>(({ domain, color, onOpen, onHover }) => {
  const { t } = useTranslation('selfLearning');
  const theme = useTheme();
  const shape = shapeOf(domain.maturity, domain.delta, domain.runCount);
  const ceiling = domain.maturity.usable
    ? (domain.maturity.pInf ?? 0)
    : Math.max(1, ...domain.series.map((p) => p.n));

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.row}
      gap={12}
      onClick={() => onOpen(domain.id)}
      onMouseEnter={() => onHover(domain.id)}
      onMouseLeave={() => onHover(undefined)}
    >
      <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Text fontSize={13.5} weight={500}>
            {domain.title}
          </Text>
          {domain.anchorPending ? (
            <Tag>{t('anchor.tag')}</Tag>
          ) : (
            <Tag>{t(`shape.tag.${shape}`)}</Tag>
          )}
        </Flexbox>
        <Text fontSize={11} type={'secondary'}>
          {t('overview.rowMeta', { lessons: domain.lessonCount, runs: domain.runCount })}
        </Text>
      </Flexbox>

      <svg height={18} style={{ flex: 'none' }} viewBox={'0 0 64 18'} width={64}>
        {domain.series.map((p, k) => {
          const w = 64 / Math.max(1, domain.series.length);
          const h = Math.max((p.n / ceiling) * 16, 1.2);
          return (
            <rect
              fill={color ?? theme.colorTextQuaternary}
              height={h}
              key={p.run}
              opacity={0.5 + (p.n / ceiling) * 0.5}
              rx={0.8}
              width={Math.max(w - 1.4, 1.4)}
              x={k * w}
              y={18 - h}
            />
          );
        })}
      </svg>

      <Text
        fontSize={12.5}
        style={{ flex: 'none', textAlign: 'right', width: 68 }}
        type={domain.maturity.usable ? undefined : 'secondary'}
        weight={600}
      >
        {domain.maturity.usable ? `${Math.round((domain.maturity.maturity ?? 0) * 100)}%` : '—'}
      </Text>
      <Text
        fontSize={12}
        style={{ flex: 'none', textAlign: 'right', width: 42 }}
        type={domain.delta > 0 ? 'success' : domain.delta < 0 ? 'warning' : 'secondary'}
      >
        {domain.delta > 0 ? `+${domain.delta}` : domain.delta < 0 ? domain.delta : '—'}
      </Text>
      <Icon icon={ChevronRightIcon} size={13} style={{ flex: 'none' }} />
    </Flexbox>
  );
});

DomainRow.displayName = 'DomainRow';
SelfLearning.displayName = 'SelfLearning';

export default SelfLearning;
