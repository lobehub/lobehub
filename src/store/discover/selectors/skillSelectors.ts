import type {
  DiscoverSkillDetail,
  DiscoverSkillItem,
  SkillCategoryItem,
  SkillCommentListResponse,
  SkillListResponse,
  SkillRatingDistribution,
} from '@/types/discover';

import type { DiscoverStore } from '../store';

const EMPTY_CATEGORIES: SkillCategoryItem[] = [];
const EMPTY_RELATED: DiscoverSkillItem[] = [];

/**
 * Readers of the skill market replicas. Every helper takes the `queryKey` the
 * matching fetch hook returned, so a surface that asks for one query never
 * reads another's rows.
 */
const skillList =
  (queryKey?: string) =>
  (s: DiscoverStore): SkillListResponse | undefined =>
    queryKey ? s.skillListMap[queryKey] : undefined;

const skillDetail =
  (queryKey?: string) =>
  (s: DiscoverStore): DiscoverSkillDetail | undefined =>
    queryKey ? s.skillDetailMap[queryKey] : undefined;

const skillCategories =
  (queryKey?: string) =>
  (s: DiscoverStore): SkillCategoryItem[] =>
    (queryKey && s.skillCategoriesMap[queryKey]) || EMPTY_CATEGORIES;

const skillComments =
  (queryKey?: string) =>
  (s: DiscoverStore): SkillCommentListResponse | undefined =>
    queryKey ? s.skillCommentsMap[queryKey] : undefined;

const skillRatingDistribution =
  (queryKey?: string) =>
  (s: DiscoverStore): SkillRatingDistribution | undefined =>
    queryKey ? s.skillRatingDistributionMap[queryKey] : undefined;

const skillRelated =
  (queryKey?: string) =>
  (s: DiscoverStore): DiscoverSkillItem[] =>
    (queryKey && s.skillRelatedMap[queryKey]) || EMPTY_RELATED;

export const skillSelectors = {
  skillCategories,
  skillComments,
  skillDetail,
  skillList,
  skillRatingDistribution,
  skillRelated,
};
