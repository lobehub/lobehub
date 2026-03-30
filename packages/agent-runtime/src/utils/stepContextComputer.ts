import type { RuntimeStepContext, StepActivatedSkill, StepContextTodos } from '@lobechat/types';

/**
 * Input parameters for computeStepContext
 * Using object parameter for future extensibility
 */
export interface ComputeStepContextParams {
  /**
   * Activated skills accumulated from activateSkill messages
   */
  activatedSkills?: StepActivatedSkill[];
  /**
   * Activated tool identifiers accumulated from lobe-activator messages
   */
  activatedToolIds?: string[];
  /**
   * Whether there are queued user messages waiting to be processed
   */
  hasQueuedMessages?: boolean;
  /**
   * Pre-computed todos state from message selector
   * Should be computed using selectTodosFromMessages in chat store selectors
   */
  todos?: StepContextTodos;
}

/**
 * Compute the Step Context from pre-computed values
 *
 * Called in internal_execAgentRuntime while loop before each runtime.step() call.
 * The stepContext is then passed through AgentRuntimeContext to Tool Executors.
 *
 * Note: The actual data (like todos) should be computed using selectors in the UI layer
 * (e.g., selectTodosFromMessages in chat store) and passed here.
 * This separation allows the selector logic to be reused for UI display.
 *
 * @param params - Object containing pre-computed state values
 * @returns RuntimeStepContext assembled from the provided values
 */
export const computeStepContext = ({
  activatedSkills,
  activatedToolIds,
  hasQueuedMessages,
  todos,
}: ComputeStepContextParams): RuntimeStepContext => {
  return {
    ...(activatedSkills?.length && { activatedSkills }),
    ...(activatedToolIds?.length && { activatedToolIds }),
    ...(hasQueuedMessages && { hasQueuedMessages }),
    ...(todos && { todos }),
  };
};
