import type {
  ActionSkillManagementHandle,
  ActionUserMemoryHandle,
  AgentSignalPolicyAction,
  SignalFeedbackDomainMemory,
  SignalFeedbackDomainSkill,
} from '../policies/types';
import { planSkillManagement, planUserMemory } from '../processors/actions';

/**
 * Skill-domain feedback signal that is eligible for direct skill-management action services.
 */
export type NonSatisfiedSkillActionServiceSignal = SignalFeedbackDomainSkill & {
  payload: SignalFeedbackDomainSkill['payload'] & {
    /** Direct skill-management planning handles unresolved or neutral skill feedback only. */
    satisfactionResult: 'neutral' | 'not_satisfied';
    /** Skill-domain discriminator preserved from the policy signal. */
    target: 'skill';
  };
};

/**
 * Describes one prepared agent-signal action and its execution risk.
 *
 * @param TAction - Exact policy action variant produced by the service.
 */
export interface AgentSignalActionPlan<TAction extends AgentSignalPolicyAction> {
  /** Exact action node prepared for runtime dispatch. */
  action: TAction;
  /** Human-readable explanation for why the action was planned. */
  reason: string;
  /** Estimated side-effect risk for orchestration, review, or gating. */
  risk: 'high' | 'low' | 'medium';
}

/**
 * Prepares user-memory actions from memory feedback-domain signals.
 */
export interface MemoryActionService {
  /**
   * Converts one memory feedback-domain signal into a dispatchable memory action plan.
   */
  prepare: (signal: SignalFeedbackDomainMemory) => AgentSignalActionPlan<ActionUserMemoryHandle>;
}

/**
 * Prepares skill-management actions from skill feedback-domain signals.
 */
export interface SkillActionService {
  /**
   * Converts one skill feedback-domain signal into a dispatchable skill-management action plan.
   */
  prepare: (
    signal: NonSatisfiedSkillActionServiceSignal,
  ) => AgentSignalActionPlan<ActionSkillManagementHandle>;
}

/**
 * Groups action services used by feedback action handlers.
 */
export interface AgentSignalActionServices {
  /** Service that prepares user-memory action plans. */
  memoryActions?: MemoryActionService;
  /** Service that prepares skill-management action plans. */
  skillActions?: SkillActionService;
}

/**
 * Creates the default action data-plane services for Agent Signal feedback actions.
 *
 * Use when:
 * - Handlers need stable memory and skill action planning without owning payload construction
 * - Tests need injectable action services while preserving server defaults
 *
 * Expects:
 * - Input signals have already been narrowed by the handler control flow
 *
 * Returns:
 * - Memory and skill action services that prepare dispatchable action plans
 */
export const createDefaultActionServices = (): Required<AgentSignalActionServices> => ({
  memoryActions: {
    prepare: (signal) => ({
      action: planUserMemory(signal),
      reason: signal.payload.reason,
      risk: 'medium',
    }),
  },
  skillActions: {
    prepare: (signal) => ({
      action: planSkillManagement(signal),
      reason: signal.payload.reason,
      risk: 'medium',
    }),
  },
});
