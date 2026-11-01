import {
  type AgentState,
  VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY,
} from '@lobechat/agent-runtime';

export { VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY };

export const hasVisibleOutputEndPublished = (state: AgentState): boolean =>
  // Example: call_llm step 3 can publish visible_output_end, then finish step 4
  // enters done. The marker is operation-wide, not tied to the terminal step.
  typeof state.metadata?.[VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY] === 'number';
