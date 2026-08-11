'use client';

import { Block, Flexbox, Tag, Text, Tooltip } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseLessonItem } from '@/services/expertise';
import { StyleSheet } from '@/utils/styles';

import type { ExpertiseTier } from './types';

const styles = StyleSheet.create({
  row: {
    borderRadius: 8,
    paddingBlock: 8,
    paddingInline: 10,
  },
});

const POLARITY_MARK: Record<string, string> = {
  bad: '✗',
  good: '✓',
  rule: '§',
};

const TIER_ORDER: ExpertiseTier[] = ['core', 'niche', 'unused'];

interface RuleListProps {
  lessons: ExpertiseLessonItem[];
}

/**
 * 规则库，按梯队分组。
 *
 * 排序按命中而不是时间：流水账才按时间排，判断系统按「实际用上过多少次」排。
 * 「一次都没用上」单独成组且不折叠 —— 它是让人做减法的信号，藏起来就没人做减法了。
 */
const RuleList = memo<RuleListProps>(({ lessons }) => {
  const { t } = useTranslation('selfLearning');

  const grouped = useMemo(() => {
    const map = new Map<ExpertiseTier, ExpertiseLessonItem[]>();
    for (const lesson of lessons) {
      const tier = lesson.tier as ExpertiseTier;
      map.set(tier, [...(map.get(tier) ?? []), lesson]);
    }
    return TIER_ORDER.map((tier) => ({ items: map.get(tier) ?? [], tier })).filter(
      (g) => g.items.length > 0,
    );
  }, [lessons]);

  return (
    <Block gap={16} padding={20} variant={'outlined'}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text weight={600}>{t('rules.title')}</Text>
        <Text fontSize={12} type={'secondary'}>
          {t('summary.lessons', { count: lessons.length })}
        </Text>
      </Flexbox>

      {grouped.map(({ tier, items }) => (
        <Flexbox gap={4} key={tier}>
          <Flexbox horizontal align={'baseline'} gap={8}>
            <Text fontSize={12} type={'secondary'} weight={600}>
              {t(`rules.tier.${tier}`)}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {tier === 'core' && t('rules.coreHint')}
              {tier === 'niche' && t('rules.nicheHint')}
              {tier === 'unused' && t('rules.unusedHint')}
            </Text>
          </Flexbox>
          {items.map((lesson) => (
            <Flexbox
              horizontal
              align={'center'}
              gap={12}
              justify={'space-between'}
              key={lesson.id}
              style={styles.row}
            >
              <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                <Text fontSize={12} type={'secondary'}>
                  {POLARITY_MARK[lesson.polarity] ?? '·'}
                </Text>
                <Text fontSize={12} type={'secondary'}>
                  {lesson.code}
                </Text>
                <Text ellipsis fontSize={13}>
                  {lesson.title}
                </Text>
                {!lesson.canonAnchor && (
                  <Tooltip title={t('rules.unanchoredDesc')}>
                    <Tag>{t('rules.unanchored')}</Tag>
                  </Tooltip>
                )}
              </Flexbox>
              <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
                {lesson.hitCount > 0
                  ? t('rules.hits', { count: lesson.hitCount })
                  : t('rules.neverUsed')}
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
