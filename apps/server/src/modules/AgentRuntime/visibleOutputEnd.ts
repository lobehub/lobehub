import type { AgentState } from '@lobechat/agent-runtime';

export const VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY =
  'visibleOutputEndPublishedStepIndex';

export const hasVisibleOutputEndPublished = (state: AgentState, stepIndex: number): boolean =>
  state.metadata?.[VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY] === stepIndex;
