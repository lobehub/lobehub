import type {
  CommandExecutionLogItem,
  CommandExecutionLogPolicyField,
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
 * governed tool call — a command execution (`checkCommand`/`policyGate.ts`) OR
 * a file operation (`checkPath`/`pathPolicy.ts`). Built once per call by
 * whoever owns the chokepoint (`BuiltinToolsExecutor`, or a sibling service's
 * own dispatcher).
 *
 * `commandText` and `path` are each meaningful for exactly one of the two
 * checks — a command-execution context sets `commandText` and leaves `path`
 * undefined, a file-operation context does the reverse — but both share this
 * one type (rather than two disjoint ones) so `logCommandExecution` can stay
 * a single function over a single row shape. See `PathGovernanceContext` in
 * `pathPolicy.ts` for the file-operation-shaped view of this same type.
 */
export interface CommandGovernanceContext {
  /** The API name invoked on the tool (e.g. `runCommand`, `writeFile`). */
  apiName: string;
  /** The literal command string the model asked to run. Command-execution calls only. */
  commandText?: string;
  /** Device id, when `executionTarget` is `device`. */
  deviceId?: string;
  executionTarget: CommandExecutionTarget;
  /** The target path checked. File-operation calls only. */
  path?: string;
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
  /** Set when a file-operation call was blocked — which `user_execution_policies` field matched. */
  matchedField?: CommandExecutionLogPolicyField;
  /** Set when a command-execution call was blocked by a `command_governance_rules` row. */
  matchedRuleId?: string;
  /** Undefined when the command never ran (blocked before dispatch). */
  success?: boolean;
}

export type { CommandExecutionLogItem, CommandExecutionLogPolicyField, CommandGovernanceRuleItem };

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
