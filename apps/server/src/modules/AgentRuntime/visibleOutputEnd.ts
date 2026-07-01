import type { AgentState } from '@lobechat/agent-runtime';

export const VISIBLE_OUTPUT_END_PUBLISHED_METADATA_KEY = 'visibleOutputEndPublished';

export const hasVisibleOutputEndPublished = (state: AgentState): boolean =>
  state.metadata?.[VISIBLE_OUTPUT_END_PUBLISHED_METADATA_KEY] === true;
