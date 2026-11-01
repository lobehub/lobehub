import type {
  AgentEvalEnvironmentInsert,
  AgentEvalMemoryItem,
  AgentEvalTestCaseInsert,
} from '@lobechat/types';

import type { agentEvalMemories } from './agentEvalMemory';
import type { agentEvalEnvironments, agentEvalTestCases } from './agentEvals';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/** Public persistence contracts must stay identical to the table rows they describe. */
export type AgentEvalRowTypesMatchSchema = [
  Assert<Equal<AgentEvalMemoryItem, typeof agentEvalMemories.$inferSelect>>,
  Assert<Equal<AgentEvalEnvironmentInsert, typeof agentEvalEnvironments.$inferInsert>>,
  Assert<Equal<AgentEvalTestCaseInsert, typeof agentEvalTestCases.$inferInsert>>,
];
