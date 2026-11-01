import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type {
  DiscoverSkillDetail,
  DiscoverSkillItem,
  SkillCategoryItem,
  SkillCommentListResponse,
  SkillListResponse,
  SkillRatingDistribution,
} from '@/types/discover';

/**
 * Replica views of the skill market reads, each beside its bookkeeping slot.
 * The views are plain records keyed by the entry key of the matching resource
 * (`projection.ts`); components read them through `skillSelectors`, never
 * through the fetch hook.
 */
export interface SkillSliceState {
  /** Category counts per query (`skillCategoriesQueryKey`). */
  skillCategoriesMap: Record<string, SkillCategoryItem[]>;
  /** Replica bookkeeping of `skillCategoriesMap`. */
  skillCategoriesReplica: ReplicaState<SkillCategoryItem[]>;
  /** Comments per query (`skillCommentsQueryKey`). */
  skillCommentsMap: Record<string, SkillCommentListResponse>;
  /** Replica bookkeeping of `skillCommentsMap`. */
  skillCommentsReplica: ReplicaState<SkillCommentListResponse>;
  /** Skill detail per identifier (`skillDetailQueryKey`). */
  skillDetailMap: Record<string, DiscoverSkillDetail>;
  /** Replica bookkeeping of `skillDetailMap`. */
  skillDetailReplica: ReplicaState<DiscoverSkillDetail>;
  /** Skill list per query (`skillListQueryKey`). */
  skillListMap: Record<string, SkillListResponse>;
  /** Replica bookkeeping of `skillListMap`. */
  skillListReplica: ReplicaState<SkillListResponse>;
  /** Rating distribution per skill (`skillRatingDistributionQueryKey`). */
  skillRatingDistributionMap: Record<string, SkillRatingDistribution>;
  /** Replica bookkeeping of `skillRatingDistributionMap`. */
  skillRatingDistributionReplica: ReplicaState<SkillRatingDistribution>;
  /** Related skills per query (`skillRelatedQueryKey`). */
  skillRelatedMap: Record<string, DiscoverSkillItem[]>;
  /** Replica bookkeeping of `skillRelatedMap`. */
  skillRelatedReplica: ReplicaState<DiscoverSkillItem[]>;
}

export const initialSkillSliceState: SkillSliceState = {
  skillCategoriesMap: {},
  skillCategoriesReplica: createReplicaState(),
  skillCommentsMap: {},
  skillCommentsReplica: createReplicaState(),
  skillDetailMap: {},
  skillDetailReplica: createReplicaState(),
  skillListMap: {},
  skillListReplica: createReplicaState(),
  skillRatingDistributionMap: {},
  skillRatingDistributionReplica: createReplicaState(),
  skillRelatedMap: {},
  skillRelatedReplica: createReplicaState(),
};
