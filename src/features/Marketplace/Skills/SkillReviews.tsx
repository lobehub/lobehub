import { AgentIcon } from '@lobehub/icons';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';

import MarketCard from './MarketCard';
import { useCompactNumber } from './SkillStats';
import Stars from './Stars';

const REVIEW_COUNT = 6;

const styles = stylex.create({
  bar: {
    flex: '1',
    height: 4,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: cssVar.colorFillSecondary,
  },
  barFill: (width: string) => ({
    width,
    height: '100%',
    borderRadius: 2,
    backgroundColor: cssVar.colorTextSecondary,
  }),
  content: {
    display: '-webkit-box',
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 4,
    fontSize: 13,
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
  },
  score: {
    fontSize: 56,
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: -1,
  },
});

/**
 * Ratings & Reviews, App Store style: the average beside a five-to-one star
 * histogram, then the latest reviews as cards.
 */
const SkillReviews = memo<{ identifier: string; ratingAverage?: number; ratingCount?: number }>(
  ({ identifier, ratingAverage, ratingCount }) => {
    const { i18n, t } = useTranslation('setting');
    const compact = useCompactNumber();
    const useFetchComments = useDiscoverStore((s) => s.useFetchSkillComments);
    const useFetchDistribution = useDiscoverStore((s) => s.useFetchSkillRatingDistribution);
    const { queryKey: commentsKey } = useFetchComments({ identifier, pageSize: REVIEW_COUNT });
    const { queryKey: distributionKey } = useFetchDistribution(identifier);
    const comments = useDiscoverStore(skillSelectors.skillComments(commentsKey));
    const distribution = useDiscoverStore(skillSelectors.skillRatingDistribution(distributionKey));

    const total = distribution?.totalCount ?? ratingCount ?? 0;
    const reviews = (comments?.items ?? []).filter((item) => item.content.trim());
    const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

    if (!total && reviews.length === 0) return null;

    return (
      <Flexbox gap={12}>
        <Flexbox horizontal align={'baseline'} justify={'space-between'}>
          <Text weight={600}>{t('market.skills.reviews.title')}</Text>
          {comments && comments.totalCount > reviews.length && (
            <Text fontSize={12} type={'secondary'}>
              {t('market.skills.reviews.total', { count: comments.totalCount })}
            </Text>
          )}
        </Flexbox>
        {total > 0 && (
          <Flexbox horizontal align={'center'} gap={32}>
            <Flexbox align={'center'} gap={4} style={{ flex: 'none' }}>
              <span {...stylex.props(styles.score)}>{(ratingAverage ?? 0).toFixed(1)}</span>
              <Text fontSize={12} type={'secondary'}>
                {t('market.skills.reviews.outOf')}
              </Text>
            </Flexbox>
            <Flexbox flex={1} gap={4}>
              {([5, 4, 3, 2, 1] as const).map((star) => {
                const count = distribution?.[star] ?? 0;
                return (
                  <Flexbox horizontal align={'center'} gap={8} key={star}>
                    <span style={{ display: 'inline-flex', justifyContent: 'flex-end', width: 64 }}>
                      <Stars size={9} value={star} />
                    </span>
                    <div {...stylex.props(styles.bar)}>
                      <div
                        {...stylex.props(styles.barFill(`${total ? (count / total) * 100 : 0}%`))}
                      />
                    </div>
                  </Flexbox>
                );
              })}
              <Text fontSize={12} style={{ alignSelf: 'flex-end' }} type={'secondary'}>
                {t('market.skills.stats.ratings', { count: compact(total) })}
              </Text>
            </Flexbox>
          </Flexbox>
        )}
        {reviews.length > 0 && (
          <div {...stylex.props(styles.grid)}>
            {reviews.map((review) => {
              const author =
                review.author?.displayName ||
                review.author?.identifier ||
                t('market.skills.reviews.anonymous');
              return (
                <MarketCard gap={8} key={review.id}>
                  <Flexbox horizontal align={'center'} gap={8}>
                    {/* A review an agent wrote wears its client's mark (Codex, Claude Code, …). */}
                    {review.author?.type === 'agent' && review.author.sourceType ? (
                      <AgentIcon
                        agent={review.author.sourceType}
                        shape={'circle'}
                        size={24}
                        type={'avatar'}
                      />
                    ) : (
                      <Avatar
                        avatar={review.author?.avatar || author.slice(0, 1).toUpperCase()}
                        background={review.author?.background ?? undefined}
                        size={24}
                      />
                    )}
                    <Text ellipsis style={{ flex: 1 }} weight={500}>
                      {author}
                    </Text>
                    <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
                      {date.format(new Date(review.createdAt))}
                    </Text>
                  </Flexbox>
                  {review.rating !== undefined && review.rating > 0 && (
                    <Stars value={review.rating} />
                  )}
                  <div {...stylex.props(styles.content)}>{review.content}</div>
                </MarketCard>
              );
            })}
          </div>
        )}
      </Flexbox>
    );
  },
);

SkillReviews.displayName = 'MarketSkillReviews';

export default SkillReviews;
