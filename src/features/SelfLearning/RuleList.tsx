'use client';

import { Block, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainDetail, ExpertiseLessonItem } from '@/services/expertise';

import type { ExpertiseTier } from './types';

/** 和分层覆盖用同一个宽度，两块并排时刻度才是同一把尺。 */
const TRACK = 88;

const styles = createStaticStyles(({ css }) => ({
  /** 与分层覆盖同一套：定宽靠右。满行长条只能读出「有」，读不出「差多少」。 */
  bar: css`
    overflow: hidden;

    width: ${TRACK}px;
    height: 4px;
    border-radius: 2px;

    background: ${cssVar.colorFillTertiary};
  `,
  fill: css`
    height: 100%;
    border-radius: 2px;
    background: ${cssVar.colorTextTertiary};
  `,
  row: css`
    padding-block: 7px;
  `,
}));

const POLARITY_MARK: Record<string, string> = {
  bad: '✗',
  good: '✓',
  rule: '§',
};

const TIER_ORDER: ExpertiseTier[] = ['core', 'niche', 'unused'];

interface RuleListProps {
  lessons: ExpertiseLessonItem[];
  stats: ExpertiseDomainDetail['lessonStats'];
}

/**
 * 骨干经验，按命中降序。
 *
 * 排序按命中而不是时间：流水账才按时间排，判断系统按「实际用上过多少次」排。
 * 「一次都没用上」单独成组且不折叠 —— 它是让人做减法的信号，藏起来就没人做减法了。
 */
const RuleList = memo<RuleListProps>(({ lessons, stats }) => {
  const { t } = useTranslation('selfLearning');

  const { grouped, maxHit } = useMemo(() => {
    const map = new Map<ExpertiseTier, ExpertiseLessonItem[]>();
    for (const lesson of lessons) {
      const tier = lesson.tier as ExpertiseTier;
      map.set(tier, [...(map.get(tier) ?? []), lesson]);
    }
    return {
      grouped: TIER_ORDER.map((tier) => ({ items: map.get(tier) ?? [], tier })).filter(
        (g) => g.items.length > 0,
      ),
      maxHit: Math.max(1, ...lessons.map((l) => l.hitCount)),
    };
  }, [lessons]);

  return (
    <Block gap={10} padding={16} variant={'outlined'}>
      <Flexbox gap={2}>
        <Text fontSize={13} weight={600}>
          {t('rules.title')}
        </Text>
        <Text fontSize={11} type={'secondary'}>
          {t('rules.stats', { hits: stats.hits, total: stats.total, unused: stats.unused })}
        </Text>
      </Flexbox>

      {grouped.map(({ tier, items }) => (
        <Flexbox gap={4} key={tier}>
          <Flexbox horizontal align={'baseline'} gap={8}>
            <Text fontSize={11.5} type={'secondary'} weight={600}>
              {t(`rules.tier.${tier}`)}
            </Text>
            <Text fontSize={11} type={'secondary'}>
              {t(`rules.hint.${tier}`)}
            </Text>
          </Flexbox>
          {items.map((lesson) => (
            <Flexbox horizontal align={'center'} className={styles.row} gap={12} key={lesson.id}>
              <Flexbox gap={1} style={{ flex: 1, minWidth: 0 }}>
                <Flexbox horizontal align={'center'} gap={7}>
                  <Text fontSize={10.5} style={{ flex: 'none', width: 34 }} type={'secondary'}>
                    {lesson.code}
                  </Text>
                  <Text fontSize={11} type={'secondary'}>
                    {POLARITY_MARK[lesson.polarity] ?? '·'}
                  </Text>
                  <Text ellipsis fontSize={12} lineHeight={1.5} style={{ flex: 1 }}>
                    {lesson.title}
                  </Text>
                </Flexbox>
                {!lesson.canonAnchor && (
                  <Flexbox horizontal paddingInline={'41px 0'}>
                    <Tag size={'small'}>{t('rules.unanchored')}</Tag>
                  </Flexbox>
                )}
              </Flexbox>
              <div className={styles.bar}>
                <div
                  className={styles.fill}
                  style={{ width: `${(lesson.hitCount / maxHit) * 100}%` }}
                />
              </div>
              <Text
                fontSize={11}
                style={{ flex: 'none', textAlign: 'right', width: 56 }}
                type={lesson.hitCount === 0 ? 'warning' : 'secondary'}
              >
                {lesson.hitCount === 0
                  ? t('rules.neverUsedShort')
                  : t('rules.hitsShort', { count: lesson.hitCount })}
              </Text>
            </Flexbox>
          ))}
        </Flexbox>
      ))}
    </Block>
  );
});

RuleList.displayName = 'RuleList';

export default RuleList;
