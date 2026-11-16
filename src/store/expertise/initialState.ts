import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type {
  ExpertiseDomainDetail,
  ExpertiseLessonDetail,
  ExpertiseOverview,
  RuleRevision,
  RuleSource,
  RulesOverview,
} from '@/services/expertise';

import type { ExpertiseHistoryCount } from './projection';

export interface ExpertiseState {
  /** One direction per domain id (replica view). */
  domainMap: Record<string, ExpertiseDomainDetail>;
  domainReplica: ReplicaState<ExpertiseDomainDetail>;
  /** Warm-up candidate count per agent id (replica view). */
  historyCountMap: Record<string, ExpertiseHistoryCount>;
  historyCountReplica: ReplicaState<ExpertiseHistoryCount>;
  /** One lesson with its hits per lesson id (replica view). */
  lessonMap: Record<string, ExpertiseLessonDetail>;
  /** Lesson ids the server confirmed are gone, in the active scope. */
  lessonNotFoundMap: Record<string, true>;
  lessonReplica: ReplicaState<ExpertiseLessonDetail>;
  /** One agent's portrait per agent id (replica view). */
  overviewMap: Record<string, ExpertiseOverview>;
  overviewReplica: ReplicaState<ExpertiseOverview>;
  /** A rule's edits per lesson id (replica view). */
  ruleRevisionsMap: Record<string, RuleRevision[]>;
  ruleRevisionsReplica: ReplicaState<RuleRevision[]>;
  /** The reviewer's rule sheet under `RULES_KEY` (replica view). */
  rulesMap: Record<string, RulesOverview>;
  /** A rule's evidence per lesson id (replica view). */
  ruleSourcesMap: Record<string, RuleSource[]>;
  ruleSourcesReplica: ReplicaState<RuleSource[]>;
  rulesReplica: ReplicaState<RulesOverview>;
}

export const initialState: ExpertiseState = {
  domainMap: {},
  domainReplica: createReplicaState(),
  historyCountMap: {},
  historyCountReplica: createReplicaState(),
  lessonMap: {},
  lessonNotFoundMap: {},
  lessonReplica: createReplicaState(),
  overviewMap: {},
  overviewReplica: createReplicaState(),
  ruleRevisionsMap: {},
  ruleRevisionsReplica: createReplicaState(),
  ruleSourcesMap: {},
  ruleSourcesReplica: createReplicaState(),
  rulesMap: {},
  rulesReplica: createReplicaState(),
};
