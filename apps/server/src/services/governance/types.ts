import type {
  CommandExecutionLogItem,
  CommandGovernancePatternType,
  CommandGovernanceRuleItem,
  CommandGovernanceScope,
} from '@lobechat/database';

/** Where a governed command actually executes. */
export type CommandExecutionTarget = 'local' | 'device' | 'sandbox';

export type { CommandGovernancePatternType, CommandGovernanceScope };

/** Currently only 'deny' is implemented; kept as a free string for extension. */
export type CommandGovernanceAction = 'deny' | (string & {});

/**
 * Everything the policy gate and audit logger need to evaluate/record one
 * command-execution tool call. Built once per call by whoever owns the
 * chokepoint (`BuiltinToolsExecutor`, or a sibling service's own dispatcher).
 */
export interface CommandGovernanceContext {
  /** The API name invoked on the tool (e.g. `runCommand`). */
  apiName: string;
  /** The literal command string the model asked to run. */
  commandText: string;
  /** Device id, when `executionTarget` is `device`. */
  deviceId?: string;
  executionTarget: CommandExecutionTarget;
  /** Builtin tool identifier (e.g. `lobe-local-system`, `lobe-cloud-sandbox`). */
  toolIdentifier: string;
  userId: string;
}

export interface CommandGovernanceDecision {
  allowed: boolean;
  /** The rule that caused a deny; absent when allowed. */
  ruleId?: string;
}

/** Outcome recorded to the audit log after a governed call resolves. */
export interface CommandGovernanceOutcome {
  blocked: boolean;
  durationMs?: number;
  errorMessage?: string;
  matchedRuleId?: string;
  /** Undefined when the command never ran (blocked before dispatch). */
  success?: boolean;
}

export type { CommandExecutionLogItem, CommandGovernanceRuleItem };
