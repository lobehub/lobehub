'use client';

import { ActionIcon, Block, Flexbox, Icon, SearchBar, Tag, Text, Tooltip } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { Button, DropdownMenu, Popover, toast } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MessageSquareTextIcon,
  MoreHorizontalIcon,
  PencilIcon,
} from 'lucide-react';
import { Fragment, memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import urlJoin from 'url-join';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ExpertiseHabit } from '@/services/expertise';
import { expertiseService } from '@/services/expertise';

import { countTiers, type HabitTier, habitTier, TIER_ORDER } from '../helpers';
import LessonPreview from './LessonPreview';
import { portraitStyles as styles } from './styles';
import TeachBox from './TeachBox';

interface HabitListProps {
  agentId: string;
  /** Start with the "formed" group open — the full-list page has nothing to fold. */
  defaultStableOpen?: boolean;
  /** Present when the list mixes several domains, so each row can say which one it belongs to. */
  domainTitles?: Record<string, string>;
  habits: (ExpertiseHabit & { domainId: string })[];
  onChanged: () => void;
  /** Where the complete, unfolded list lives; renders a "view all" link in the header. */
  viewAllPath?: string;
}

const RecentDots = memo<{ recent: ExpertiseHabit['recent'] }>(({ recent }) => {
  const { t } = useTranslation('selfLearning');
  const tip =
    recent.length === 0
      ? t('habit.recentTip.none')
      : t('habit.recentTip.title', {
          count: recent.length,
          list: recent
            .map((r) => (r.pass ? t('habit.recentTip.pass') : t('habit.recentTip.violation')))
            .join(' '),
        });
  return (
    <Tooltip title={tip}>
      <Flexbox horizontal gap={3} style={{ flex: 'none' }}>
        {recent.length === 0
          ? [0, 1, 2].map((i) => <span className={`${styles.dot} ${styles.dotNone}`} key={i} />)
          : recent.map((r, i) => (
              <span className={`${styles.dot} ${r.pass ? styles.dotOk : styles.dotBad}`} key={i} />
            ))}
      </Flexbox>
    </Tooltip>
  );
});

RecentDots.displayName = 'ExpertiseRecentDots';

interface HabitRowProps {
  agentId: string;
  domainTitle?: string;
  habit: ExpertiseHabit & { domainId: string };
  onChanged: () => void;
  tier: HabitTier;
}

const HabitRow = memo<HabitRowProps>(({ agentId, domainTitle, habit, onChanged, tier }) => {
  const { t } = useTranslation('selfLearning');
  const navigate = useWorkspaceAwareNavigate();
  const [teaching, setTeaching] = useState(false);

  const hint = useMemo(() => {
    if (habit.taughtByUser && habit.recent.length === 0) return t('habit.hint.taughtPending');
    const bad = habit.recent.filter((r) => !r.pass);
    const lastBad = [...bad].reverse()[0];
    const topic = lastBad?.subjectTitle ?? undefined;
    switch (tier) {
      case 'recurring': {
        return topic
          ? t('habit.hint.recurring', { bad: bad.length, topic, total: habit.recent.length })
          : t('habit.hint.recurringNoTopic', { bad: bad.length, total: habit.recent.length });
      }
      case 'shaky': {
        return topic
          ? t('habit.hint.shaky', { topic, total: habit.recent.length })
          : t('habit.hint.shakyNoTopic', { total: habit.recent.length });
      }
      case 'fresh': {
        return habit.recent.length === 0 ? t('habit.hint.freshNone') : t('habit.hint.freshOne');
      }
      default: {
        return t('habit.hint.stable', { count: habit.hitCount });
      }
    }
  }, [habit, t, tier]);

  const revise = async (text: string) => {
    try {
      await expertiseService.reviseLesson({ lessonId: habit.id, text });
      toast.success(t('habit.teach.done'));
      setTeaching(false);
      onChanged();
    } catch {
      toast.error(t('habit.teach.failed'));
    }
  };

  const retire = async () => {
    try {
      await expertiseService.retireLesson(habit.id);
      toast.success(t('habit.teach.forgot'));
      onChanged();
    } catch {
      toast.error(t('habit.teach.failed'));
    }
  };

  const lessonPath = urlJoin(
    '/agent',
    agentId,
    'self-evolving',
    habit.domainId,
    'experience',
    habit.id,
  );
  const menu: DropdownItem[] = [
    {
      icon: <Icon icon={PencilIcon} />,
      key: 'correct',
      label: t('habit.action.correct'),
      onClick: () => setTeaching(true),
    },
    {
      icon: <Icon icon={MessageSquareTextIcon} />,
      key: 'source',
      label: t('habit.action.source'),
      onClick: () => navigate(lessonPath),
    },
    { type: 'divider' },
    {
      danger: true,
      icon: <Icon icon={ArchiveIcon} />,
      key: 'forget',
      label: t('habit.action.forget'),
      onClick: retire,
    },
  ];

  return (
    <Flexbox className={styles.row} gap={6}>
      <Flexbox horizontal align={'flex-start'} gap={12}>
        <Text code fontSize={12} style={{ flex: 'none', marginTop: 2 }} type={'secondary'}>
          {habit.code}
        </Text>
        <Popover
          // Long enough that dragging the pointer down the list does not fetch every row.
          openDelay={420}
          // Above the row rather than below it: the row's own hint sits directly beneath the
          // title, so a card there buries the line the reader just came from.
          placement={'topRight'}
          // This stack never flips a popup to the opposite side, so the card has to fit in the
          // space above the row; the padding keeps it clear of the viewport edge.
          positionerProps={{ collisionPadding: 12 }}
          trigger={'hover'}
          content={
            <LessonPreview
              code={habit.code}
              layer={habit.layer}
              lessonId={habit.id}
              lessonPath={lessonPath}
              title={habit.title}
            />
          }
        >
          <Flexbox
            className={styles.previewTarget}
            gap={2}
            style={{ flex: 1, minWidth: 0 }}
            onClick={() => navigate(lessonPath)}
            // base-ui gives the trigger role="button" and focus, but brings no activation of
            // its own, so a keyboard user could tab here and have Enter do nothing.
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              navigate(lessonPath);
            }}
          >
            <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
              <Text fontSize={13.5} weight={500}>
                {habit.title}
              </Text>
              {habit.taughtByUser && (
                <Tag>
                  {t('habit.taughtTag')} · {dayjs(habit.createdAt).fromNow()}
                </Tag>
              )}
              {domainTitle && <Tag>{domainTitle}</Tag>}
            </Flexbox>
            <Text fontSize={12} type={'secondary'}>
              {hint}
            </Text>
          </Flexbox>
        </Popover>
        <RecentDots recent={habit.recent} />
        <Flexbox horizontal align={'center'} className={'teach'} gap={4} style={{ flex: 'none' }}>
          {(tier === 'recurring' || tier === 'shaky') && (
            <Button
              size={'small'}
              type={tier === 'recurring' ? 'primary' : 'default'}
              onClick={() => setTeaching((v) => !v)}
            >
              {t('habit.action.teachAgain')}
            </Button>
          )}
          <DropdownMenu items={menu}>
            <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
          </DropdownMenu>
        </Flexbox>
      </Flexbox>
      {teaching && (
        <Flexbox style={{ paddingInlineStart: 48 }}>
          <TeachBox
            autoFocus
            placeholder={
              tier === 'recurring'
                ? t('habit.teach.placeholderRecurring')
                : t('habit.teach.placeholderCorrect')
            }
            onSubmit={revise}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

HabitRow.displayName = 'ExpertiseHabitRow';

/**
 * 习惯清单，按可靠度分组：老毛病 → 还不稳 → 刚学的 展开，已养成 折起。
 * 值得看的都在上面，稳的收起来 —— 用户不需要有精力逐条过。
 */
const HabitList = memo<HabitListProps>(
  ({ agentId, defaultStableOpen = false, domainTitles, habits, onChanged, viewAllPath }) => {
    const { t } = useTranslation('selfLearning');
    const [search, setSearch] = useState('');
    const [stableOpen, setStableOpen] = useState(defaultStableOpen);

    const counts = useMemo(() => countTiers(habits), [habits]);
    const grouped = useMemo(() => {
      const g: Record<HabitTier, HabitListProps['habits']> = {
        fresh: [],
        recurring: [],
        shaky: [],
        stable: [],
      };
      const q = search.trim().toLowerCase();
      for (const h of habits) {
        if (q && !h.title.toLowerCase().includes(q) && !h.code.toLowerCase().includes(q)) continue;
        g[habitTier(h.recent)].push(h);
      }
      return g;
    }, [habits, search]);

    const stableVisible = stableOpen || !!search.trim();

    return (
      <Flexbox gap={10}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'baseline'} gap={8}>
            <Text weight={600}>{t('habits.title')}</Text>
            <Text fontSize={12} type={'secondary'}>
              {t('habits.summary', counts)}
            </Text>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8}>
            {viewAllPath && (
              <Link className={styles.viewAll} to={viewAllPath}>
                {t('habits.viewAll', { count: habits.length })}
              </Link>
            )}
            <SearchBar
              placeholder={t('habits.search')}
              style={{ width: 200 }}
              value={search}
              variant={'filled'}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Flexbox>
        </Flexbox>
        <Block padding={0} variant={'outlined'}>
          {TIER_ORDER.filter((tier) => tier !== 'stable').map((tier) => {
            const rows = grouped[tier];
            if (rows.length === 0) return null;
            return (
              <Fragment key={tier}>
                <Flexbox horizontal align={'center'} className={styles.groupHead} gap={8}>
                  <Text
                    className={tier === 'recurring' ? styles.accent : undefined}
                    fontSize={12.5}
                    weight={600}
                  >
                    {t(`tier.${tier}`)} {rows.length}
                  </Text>
                  <Text fontSize={12} type={'secondary'}>
                    {t(`tier.${tier}Sub`)}
                  </Text>
                </Flexbox>
                {rows.map((h) => (
                  <HabitRow
                    agentId={agentId}
                    domainTitle={domainTitles?.[h.domainId]}
                    habit={h}
                    key={h.id}
                    tier={tier}
                    onChanged={onChanged}
                  />
                ))}
              </Fragment>
            );
          })}
          <Flexbox
            horizontal
            align={'center'}
            as={'button'}
            className={styles.groupHead}
            gap={8}
            justify={'space-between'}
            style={{ background: undefined, color: 'inherit', cursor: 'pointer', width: '100%' }}
            onClick={() => setStableOpen((v) => !v)}
          >
            <Flexbox horizontal align={'center'} gap={8}>
              <Text fontSize={12.5} weight={600}>
                {t('tier.stable')} {grouped.stable.length}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {t('tier.stableSub')}
              </Text>
            </Flexbox>
            <Icon icon={stableVisible ? ChevronUpIcon : ChevronDownIcon} size={14} />
          </Flexbox>
          {stableVisible &&
            grouped.stable.map((h) => (
              <HabitRow
                agentId={agentId}
                domainTitle={domainTitles?.[h.domainId]}
                habit={h}
                key={h.id}
                tier={'stable'}
                onChanged={onChanged}
              />
            ))}
        </Block>
      </Flexbox>
    );
  },
);

HabitList.displayName = 'ExpertiseHabitList';

export default HabitList;
