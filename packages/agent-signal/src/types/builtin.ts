import type { AgenticAttempt, BaseSignal, ExecutorError, SignalAttempt } from '../base/types';
import type { AGENT_SIGNAL_TYPES, AgentSignalBuiltInSignalType } from './events';

/**
 * Signal plan returned by one built-in AgentSignal policy.
 */
export interface SignalPlan {
  policyId: string;
  scopeKey: string;
  signals: BaseSignal[];
}

/**
 * Built-in AgentSignal signal payloads keyed by signal type.
 */
export interface AgentSignalBuiltInSignalPayloadMap {
  [AGENT_SIGNAL_TYPES.actionApplied]: {
    actionId: string;
    actionType: string;
    attempt: SignalAttempt | AgenticAttempt;
    detail?: string;
  };
  [AGENT_SIGNAL_TYPES.actionFailed]: {
    actionId: string;
    actionType: string;
    attempt: SignalAttempt | AgenticAttempt;
    detail?: string;
    error: ExecutorError;
  };
  [AGENT_SIGNAL_TYPES.actionSkipped]: {
    actionId: string;
    actionType: string;
    attempt: SignalAttempt | AgenticAttempt;
    detail?: string;
  };
}

/**
 * Built-in AgentSignal signal variant.
 */
export type AgentSignalBuiltInSignalVariant<
  TSignalType extends AgentSignalBuiltInSignalType = AgentSignalBuiltInSignalType,
> = BaseSignal & {
  payload: AgentSignalBuiltInSignalPayloadMap[TSignalType];
  signalType: TSignalType;
};

/**
 * Built-in AgentSignal signal union.
 */
export type AgentSignalBuiltInSignal = {
  [TSignalType in AgentSignalBuiltInSignalType]: AgentSignalBuiltInSignalVariant<TSignalType>;
}[AgentSignalBuiltInSignalType];

/**
 * Built-in AgentSignal signal aliases retained for downstream compatibility.
 */
export type SignalActionApplied = AgentSignalBuiltInSignalVariant<'signal.action.applied'>;
export type SignalActionSkipped = AgentSignalBuiltInSignalVariant<'signal.action.skipped'>;
export type SignalActionFailed = AgentSignalBuiltInSignalVariant<'signal.action.failed'>;
