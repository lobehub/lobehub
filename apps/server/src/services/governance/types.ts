import type {
  CommandExecutionLogItem,
  CommandGovernancePatternType,
  CommandGovernanceRuleItem,
  CommandGovernanceScope,
  UserExecutionPolicyCommandMode,
  UserExecutionPolicyItem,
} from '@lobechat/database/schemas';

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

export type { UserExecutionPolicyCommandMode, UserExecutionPolicyItem };

/**
 * The fields the SRT engine's `SandboxPolicy` needs, resolved for one user.
 * Field names mirror `SandboxPolicy` (`packages/device-sandbox/src/types.ts`)
 * 1:1 on purpose — the CLI/desktop client maps this straight across, adding
 * only the client-local `onUnavailable` field `SandboxPolicy` also carries.
 * `null` means "no policy row for this user" — unrestricted, not "denied".
 */
export interface ResolvedExecutionPolicy {
  allowedNetworkDomains?: string[];
  allowNetwork: boolean;
  commandMode: UserExecutionPolicyCommandMode;
  deniedReadRoots?: string[];
  deniedWriteRoots?: string[];
  enabled: boolean;
  envAllowlist?: string[];
  readableRoots?: string[];
  writableRoots: string[];
}
