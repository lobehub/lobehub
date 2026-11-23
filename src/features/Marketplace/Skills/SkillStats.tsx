import { type MetricItem, MetricStrip } from '@lobehub/ui/dashboard';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Download, MessageSquare, Star } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getSkillCategoryStyle } from './skillCategoryStyle';
import Stars from './Stars';

/** 2.6k, 1.2M: App Store-style short counts in the UI language. */
export const useCompactNumber = () => {
  const { i18n } = useTranslation();
  const format = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 1,
    notation: 'compact',
  });
  return (value: number) => format.format(value);
};

export interface SkillStatsData {
  category?: string;
  commentCount?: number;
  installCount?: number;
  ratingAverage?: number;
  ratingCount?: number;
  stars?: number;
  version?: string;
}

/** A count worth a cell: present and above zero. */
const shown = (value?: number): value is number => !!value && value > 0;

export type SkillStatKey = 'category' | 'installs' | 'rating' | 'reviews' | 'stars' | 'version';

/** Which figures a skill has worth showing, in strip order. */
export const skillStatKeys = (data: SkillStatsData): SkillStatKey[] => {
  const keys: SkillStatKey[] = [];
  if (shown(data.ratingCount) && shown(data.ratingAverage)) keys.push('rating');
  if (shown(data.installCount)) keys.push('installs');
  if (shown(data.stars)) keys.push('stars');
  if (shown(data.commentCount)) keys.push('reviews');
  if (data.category) keys.push('category');
  if (data.version) keys.push('version');
  return keys;
};

/**
 * The figures under a skill's header, as a lobe-ui MetricStrip: rating,
 * installs, GitHub stars, reviews, category and version.
 * A figure the market does not have, or that is still zero, is left out; with
 * nothing to show the strip is gone too.
 */
const SkillStats = memo<{ data: SkillStatsData }>(({ data }) => {
  const { t } = useTranslation(['setting', 'discover']);
  const compact = useCompactNumber();
  const { category, commentCount, installCount, ratingAverage, ratingCount, stars, version } = data;
  const keys = new Set(skillStatKeys(data));

  const items: MetricItem[] = [];
  if (keys.has('rating') && ratingAverage && ratingCount)
    items.push({
      hint: <Stars value={ratingAverage} />,
      label: t('market.skills.stats.ratings', { count: ratingCount }),
      mark: Star,
      value: ratingAverage.toFixed(1),
    });
  if (keys.has('installs') && installCount)
    items.push({
      label: t('market.skills.stats.installs'),
      mark: Download,
      value: compact(installCount),
    });
  if (keys.has('stars') && stars)
    items.push({ label: t('market.skills.stats.stars'), mark: Star, value: compact(stars) });
  if (keys.has('reviews') && commentCount)
    items.push({
      label: t('market.skills.stats.reviews'),
      mark: MessageSquare,
      value: compact(commentCount),
    });
  if (keys.has('category') && category)
    items.push({
      label: t('market.detail.category'),
      mark: getSkillCategoryStyle(category)?.icon ?? SkillsIcon,
      value: t(`skills.categories.${category}.name`, { defaultValue: category, ns: 'discover' }),
    });
  if (keys.has('version') && version)
    items.push({
      hint: t('market.skills.stats.latest'),
      label: t('market.skills.version'),
      value: version,
    });

  if (items.length === 0) return null;

  return <MetricStrip items={items} />;
});

SkillStats.displayName = 'MarketSkillStats';

export default SkillStats;
