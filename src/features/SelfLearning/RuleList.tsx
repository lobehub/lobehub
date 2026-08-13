'use client';

import { Block, Flexbox, Tag, Text, Tooltip } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ArrowRightIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainDetail, ExpertiseLessonItem } from '@/services/expertise';

import { groupLessons } from './ruleListHelpers';
import type { ExpertiseTier } from './types';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    overflow: hidden;
    min-width: 0;
  `,
  code: css`
    align-self: center;
    width: 40px;
  `,
  row: css`
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) 72px;
    column-gap: 8px;
    align-items: center;

    padding-block: 7px;
  `,
  usage: css`
    overflow: hidden;
    height: 5px;
    border-radius: 4px;
    background: var(--ant-color-fill-quaternary);
  `,
}));

interface RuleListProps {
  compact?: boolean;
  lessons: ExpertiseLessonItem[];
  stats: ExpertiseDomainDetail['lessonStats'];
  viewAllHref?: string;
}

/**
 * 骨干经验，按命中降序。
 *
 * 排序按命中而不是时间：流水账才按时间排，判断系统按「实际用上过多少次」排。
 * 「一次都没用上」单独成组且不折叠 —— 它是让人做减法的信号，藏起来就没人做减法了。
 */
const RuleList = memo<RuleListProps>(({ compact, lessons, stats, viewAllHref }) => {
  const { t } = useTranslation('selfLearning');
  const [tierFilter, setTierFilter] = useState<ExpertiseTier | 'all'>('all');

  const grouped = useMemo(() => {
    return groupLessons(lessons, compact ? 5 : undefined);
  }, [compact, lessons]);

  const visibleGroups = useMemo(() => {
    const filtered = tierFilter === 'all' ? grouped : grouped.filter((g) => g.tier === tierFilter);
    return filtered;
  }, [grouped, tierFilter]);
  const maxHits = Math.max(1, ...lessons.map((lesson) => lesson.hitCount));

  return (
    <Block gap={10} padding={16} variant={'outlined'}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <Flexbox gap={2}>
          <Text fontSize={13} weight={600}>
            {t('rules.title')}
          </Text>
          <Text fontSize={11} type={'secondary'}>
            {t('rules.stats', { hits: stats.hits, total: stats.total, unused: stats.unused })}
          </Text>
        </Flexbox>
        {!compact && (
          <Select
            size={'small'}
            style={{ width: 112 }}
            value={tierFilter}
            variant={'filled'}
            options={[
              { label: t('rules.filter.all'), value: 'all' },
              { label: t('rules.filter.core'), value: 'core' },
              { label: t('rules.filter.niche'), value: 'niche' },
              { label: t('rules.filter.unused'), value: 'unused' },
            ]}
            onChange={(value) => value && setTierFilter(value as ExpertiseTier | 'all')}
          />
        )}
      </Flexbox>

      {visibleGroups.map(({ tier, items }) => (
        <Flexbox gap={4} key={tier}>
          {items.map((lesson) => (
            <div className={styles.row} key={lesson.id}>
              <Text className={styles.code} fontSize={10.5} type={'secondary'}>
                {lesson.code}
              </Text>
              <Flexbox horizontal align={'center'} className={styles.content} gap={8}>
                <Text ellipsis fontSize={12} lineHeight={1.5} style={{ flex: 1 }}>
                  {lesson.title}
                </Text>
                {!lesson.canonAnchor && (
                  <Tag size={'small'} style={{ flex: 'none' }}>
                    {t('rules.unanchored')}
                  </Tag>
                )}
              </Flexbox>
              <Tooltip title={t('rules.hitCount', { count: lesson.hitCount })}>
                <div className={styles.usage}>
                  <div
                    style={{
                      background: 'var(--ant-color-primary)',
                      height: '100%',
                      opacity: lesson.hitCount === 0 ? 0 : 0.65,
                      width: `${(lesson.hitCount / maxHits) * 100}%`,
                    }}
                  />
                </div>
              </Tooltip>
            </div>
          ))}
        </Flexbox>
      ))}

      {compact && lessons.length > 5 && viewAllHref && (
        <Button href={viewAllHref} icon={ArrowRightIcon}>
          {t('rules.viewAll', { count: lessons.length })}
        </Button>
      )}
    </Block>
  );
});

RuleList.displayName = 'RuleList';

export default RuleList;
