'use client';

import { Block, Center, Empty, Flexbox, Icon } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { ActionIcon, Button, confirmModal, DropdownMenu, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { DnaIcon, HistoryIcon, MoreHorizontalIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ExpertiseDomainItem } from '@/services/expertise';
import { expertiseService } from '@/services/expertise';
import { useAgentStore } from '@/store/agent';

import { countTiers, habitTier } from './helpers';
import { useExpertiseOverview, useHistoryCount } from './hooks';
import AnchorCard from './Portrait/AnchorCard';
import DomainList from './Portrait/DomainList';
import GrowthCharts from './Portrait/GrowthCharts';
import HabitList from './Portrait/HabitList';
import LayerProfile from './Portrait/LayerProfile';
import { portraitStyles } from './Portrait/styles';
import TaughtList from './Portrait/TaughtList';
import TeachBox from './Portrait/TeachBox';
import { useHistoryWarmup } from './Portrait/useHistoryWarmup';
import WarmupCard from './Portrait/WarmupCard';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    display: flex;
  `,
}));

/**
 * 成长画像 —— 自进化的 L0，也是单方向时的全部。
 *
 * 感知单位是「习惯 + 它靠不靠谱」，不是「学到几条」：判断句、按层画像、习惯分组、做对率曲线
 * 全部由 hits.outcome 折出来。这里没有任何必办事项 —— 教学台，不是审批台。
 * 带 :domainId 进来时就是同一张画像收窄到一个方向。
 */
const SelfLearning = memo(() => {
  const { t } = useTranslation('selfLearning');
  const navigate = useWorkspaceAwareNavigate();
  const { domainId } = useParams();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const [teachOpen, setTeachOpen] = useState(false);
  const [teachDomainId, setTeachDomainId] = useState<string>();

  // Two-phase: read once to know how many lessons exist, then let the warm-up hook decide the poll.
  const first = useExpertiseOverview(activeAgentId ?? undefined);
  const learnedTotal = useMemo(
    () => first.data?.domains.reduce((a, d) => a + d.lessons.length, 0) ?? 0,
    [first.data],
  );
  const warmup = useHistoryWarmup(activeAgentId ?? undefined, learnedTotal);
  const { data, error, mutate } = useExpertiseOverview(
    activeAgentId ?? undefined,
    warmup.refreshInterval,
  );
  const allDomains = useMemo(() => data?.domains ?? [], [data]);
  const scoped = useMemo(
    () => (domainId ? allDomains.filter((d) => d.id === domainId) : allDomains),
    [allDomains, domainId],
  );
  const single = scoped.length === 1;
  const current: ExpertiseDomainItem | undefined = single ? scoped[0] : undefined;
  const habits = useMemo(
    () => scoped.flatMap((d) => d.lessons.map((l) => ({ ...l, domainId: d.id }))),
    [scoped],
  );
  const runs = scoped.reduce((a, d) => a + d.runCount, 0);
  const domainTitles = useMemo(
    () => Object.fromEntries(allDomains.map((d) => [d.id, d.title])),
    [allDomains],
  );

  /**
   * 判断句永远说一件具体的事 —— 多个方向时也是先挑最值得说的那个方向（老毛病 > 还不稳），
   * 「N 个方向、M 个习惯」这种盘点放到副标题里。
   */
  const sentenceFor = useCallback(
    (d: ExpertiseDomainItem): { detail?: string; headline: string } => {
      const name = d.title;
      const list = d.lessons;
      const c = countTiers(list);
      if (d.runCount === 0) return { headline: t('headline.single.notPracticed', { name }) };
      const recurring = list.find((h) => habitTier(h.recent) === 'recurring');
      if (recurring)
        return {
          detail: t('headline.detail.recurring', {
            title:
              recurring.title.length > 18 ? `${recurring.title.slice(0, 17)}…` : recurring.title,
          }),
          headline: t('headline.single.recurring', { name, runs: d.runCount }),
        };
      if (c.shaky > 0)
        return {
          detail: t('headline.detail.shaky', { count: c.shaky }),
          headline: t('headline.single.shaky', { name, runs: d.runCount }),
        };
      if (c.stable === 0)
        return {
          headline: t('headline.single.fresh', { count: list.length, name, runs: d.runCount }),
        };
      return { headline: t('headline.single.stable', { name, runs: d.runCount }) };
    },
    [t],
  );

  const sentence = useMemo(() => {
    if (scoped.length === 0) return { headline: '' };
    if (single && current) return sentenceFor(current);
    const rank = (d: ExpertiseDomainItem) => {
      const c = countTiers(d.lessons);
      return c.recurring > 0 ? 0 : c.shaky > 0 ? 1 : d.runCount === 0 ? 3 : 2;
    };
    const focus = [...scoped].sort((a, b) => rank(a) - rank(b))[0];
    return rank(focus) <= 1
      ? sentenceFor(focus)
      : { headline: t('headline.multi.ok', { domains: scoped.length }) };
  }, [current, scoped, sentenceFor, single, t]);

  const subline = [
    sentence.detail,
    single
      ? t('headline.subline', { habits: habits.length, runs })
      : t('headline.sublineMulti', { domains: scoped.length, habits: habits.length }),
  ]
    .filter(Boolean)
    .join(' · ');

  // The warm-up card is front and centre only for directions that have never been practiced.
  const freshDomains = scoped.filter((d) => d.runCount === 0 && d.lessons.length === 0);
  const showWarmup = warmup.phase !== 'idle' || freshDomains.length > 0;
  const warmupTitles =
    freshDomains.length > 0
      ? freshDomains.map((d) => d.title)
      : [current?.title ?? scoped[0]?.title ?? ''];
  // Only the warm-up card needs the candidate count, so it is not requested at all once every
  // direction has been practiced; when it is needed it batches with the portrait only on a
  // warm SWR cache (cold loads resolve the portrait first).
  const { data: history } = useHistoryCount(showWarmup ? (activeAgentId ?? undefined) : undefined);

  const teach = async (text: string) => {
    const target = teachDomainId ?? current?.id ?? scoped[0]?.id;
    if (!target) return;
    try {
      await expertiseService.teachLesson({ domainId: target, text });
      toast.success(t('habit.teach.done'));
      setTeachOpen(false);
      void mutate();
    } catch {
      toast.error(t('habit.teach.failed'));
    }
  };

  const openCreate = () => {
    if (!activeAgentId) return;
    navigate(urlJoin('/agent', activeAgentId, 'self-evolving/new'));
  };

  // Dropping a direction takes its habits and practice history with it — say so before asking.
  const confirmDelete = (domain: ExpertiseDomainItem) => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('domain.deleteConfirm.content', {
        habits: domain.lessons.length,
        runs: domain.runCount,
      }),
      okButtonProps: { danger: true },
      okText: t('domain.deleteConfirm.ok'),
      onOk: async () => {
        try {
          await expertiseService.deleteDomain(domain.id);
          toast.success(t('domain.deleted'));
          await mutate();
          if (domainId && activeAgentId)
            navigate(urlJoin('/agent', activeAgentId, 'self-evolving'));
        } catch {
          toast.error(t('domain.deleteFailed'));
        }
      },
      title: t('domain.deleteConfirm.title', { name: domain.title }),
    });
  };

  // Secondary actions live in one menu: reviewing history is occasional, deleting is rare.
  const moreMenu: DropdownItem[] = [
    ...(showWarmup
      ? []
      : [
          {
            disabled: warmup.starting,
            icon: <Icon icon={HistoryIcon} />,
            key: 'warmup',
            label: t('nav.warmup'),
            onClick: () => void warmup.start(),
          } satisfies DropdownItem,
        ]),
    ...(current
      ? [
          ...(showWarmup ? [] : [{ type: 'divider' } satisfies DropdownItem]),
          {
            danger: true,
            icon: <Icon icon={Trash2Icon} />,
            key: 'delete',
            label: t('domain.delete'),
            onClick: () => confirmDelete(current),
          } satisfies DropdownItem,
        ]
      : []),
  ];

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        styles={{ left: { paddingInlineStart: 24 } }}
        left={
          activeAgentId ? (
            <AgentBreadcrumb
              agentId={activeAgentId}
              // Whenever the portrait is about one direction — drilled in, or the only one
              // there is — say so in the trail; otherwise the headline reads like a page title.
              extraItems={current ? [current.title] : undefined}
              title={
                domainId && current ? (
                  <Link to={urlJoin('/agent', activeAgentId, 'self-evolving')}>{t('title')}</Link>
                ) : (
                  t('title')
                )
              }
            />
          ) : null
        }
        right={
          activeAgentId && allDomains.length > 0 ? (
            <Flexbox horizontal gap={8}>
              <Button icon={PlusIcon} onClick={() => setTeachOpen((v) => !v)}>
                {t('nav.teach')}
              </Button>
              {/* Starting a new direction belongs to the overview, not to one direction's page. */}
              {!domainId && (
                <Button type={'text'} onClick={openCreate}>
                  {t('nav.newDomain')}
                </Button>
              )}
              {moreMenu.length > 0 && (
                <DropdownMenu items={moreMenu}>
                  <ActionIcon
                    icon={MoreHorizontalIcon}
                    loading={warmup.starting}
                    title={t('domain.more')}
                  />
                </DropdownMenu>
              )}
            </Flexbox>
          ) : null
        }
      />
      <Flexbox className={styles.body} flex={1} width={'100%'}>
        <WideScreenContainer>
          <AsyncBoundary
            data={data}
            error={error}
            errorVariant={'page'}
            isEmpty={!error && allDomains.length === 0}
            empty={
              <Center height={'100%'} style={{ minHeight: '50vh' }} width={'100%'}>
                <Empty
                  description={t('empty.desc')}
                  descriptionProps={{ fontSize: 13 }}
                  icon={DnaIcon}
                  style={{ maxWidth: 420 }}
                  title={t('empty.title')}
                  action={
                    <Button icon={PlusIcon} type={'primary'} onClick={openCreate}>
                      {t('nav.newDomain')}
                    </Button>
                  }
                />
              </Center>
            }
            onRetry={() => mutate()}
          >
            <Flexbox gap={20} paddingBlock={'22px 64px'}>
              <Flexbox gap={4}>
                <Text className={portraitStyles.sentence}>{sentence.headline}</Text>
                <Text type={'secondary'}>{subline}</Text>
              </Flexbox>

              {teachOpen && (
                <Block padding={12} variant={'outlined'}>
                  <Flexbox gap={8}>
                    <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                      <Text fontSize={12} type={'secondary'}>
                        {t('teachNew.help')}
                      </Text>
                      {!single && (
                        <Flexbox horizontal align={'center'} gap={6}>
                          <Text fontSize={12} type={'secondary'}>
                            {t('teachNew.domain')}
                          </Text>
                          {scoped.map((d) => (
                            <Button
                              key={d.id}
                              size={'small'}
                              type={
                                (teachDomainId ?? scoped[0].id) === d.id ? 'primary' : 'default'
                              }
                              onClick={() => setTeachDomainId(d.id)}
                            >
                              {d.title}
                            </Button>
                          ))}
                        </Flexbox>
                      )}
                    </Flexbox>
                    <TeachBox autoFocus placeholder={t('teachNew.placeholder')} onSubmit={teach} />
                  </Flexbox>
                </Block>
              )}

              {showWarmup && (
                <WarmupCard
                  candidateCount={history?.candidateCount}
                  domainTitles={warmupTitles}
                  warmup={warmup}
                />
              )}

              {runs > 0 && <GrowthCharts domains={scoped} />}

              {current && <LayerProfile domain={current} />}

              <TaughtList habits={habits} />

              {habits.length > 0 && activeAgentId && (
                <HabitList
                  agentId={activeAgentId}
                  domainTitles={single ? undefined : domainTitles}
                  habits={habits}
                  viewAllPath={
                    current
                      ? urlJoin('/agent', activeAgentId, 'self-evolving', current.id, 'experience')
                      : undefined
                  }
                  onChanged={() => void mutate()}
                />
              )}

              {current && <AnchorCard domain={current} />}

              {!single && !domainId && (
                <DomainList
                  domains={allDomains}
                  onOpen={(id) => {
                    if (!activeAgentId) return;
                    navigate(urlJoin('/agent', activeAgentId, 'self-evolving', id));
                  }}
                />
              )}
            </Flexbox>
          </AsyncBoundary>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

SelfLearning.displayName = 'SelfLearning';

export default SelfLearning;
