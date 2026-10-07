import { stripCliConfigKey, stripCliFlags } from './heteroCliArgs';

/** Selectable permission profiles for the native Codex app-server transport. */
export const CODEX_PERMISSION_MODES = ['full-access', 'ask', 'auto-review', 'read-only'] as const;

/** Persisted user-selected Codex permission preset. */
export type CodexPermissionMode = (typeof CODEX_PERMISSION_MODES)[number];
/** Preset label, or custom when raw arguments describe another configuration. */
export type EffectiveCodexPermissionMode = CodexPermissionMode | 'custom';

/** Complete top-level permission configuration for a named preset. */
export interface CodexPermissionProfile {
  /** Controls which native actions require permission. */
  approvalPolicy: 'never' | 'on-request';
  /** Selects a person or the native automatic reviewer. */
  approvalsReviewer: 'auto_review' | 'user';
  /** Filesystem isolation applied when starting or resuming a thread. */
  sandbox: 'danger-full-access' | 'read-only' | 'workspace-write';
}

/** Display label and provenance for the permission selection. */
export interface ResolvedCodexPermissionMode {
  /** Effective preset or an explicitly custom CLI configuration. */
  mode: EffectiveCodexPermissionMode;
  /** Whether the selection came from the persisted field or raw CLI arguments. */
  source: 'agent' | 'legacy';
}

/** Permission fields requested by raw Codex CLI arguments. */
export interface CodexPermissionArgs {
  /** Last requested approval policy; defaults to `never`. */
  approvalPolicy: string;
  /** Last requested reviewer; defaults to `user`. */
  approvalsReviewer: string;
  /** Matching preset, or custom for conflicting or expanded configurations. */
  mode: EffectiveCodexPermissionMode;
  /** Last requested sandbox; defaults to `danger-full-access`. */
  sandbox: string;
}

export const CODEX_APPROVAL_FLAGS = ['-a', '--ask-for-approval'] as const;
export const CODEX_CONFIG_FLAGS = ['-c', '--config'] as const;
export const CODEX_DANGEROUS_BYPASS_FLAG = '--dangerously-bypass-approvals-and-sandbox';
export const CODEX_FULL_AUTO_FLAG = '--full-auto';
export const CODEX_SANDBOX_FLAGS = ['-s', '--sandbox'] as const;
const CODEX_PERMISSION_CONFIG_KEYS = [
  'approval_policy',
  'approvals_reviewer',
  'sandbox_mode',
] as const;

/** Named approval policies accepted by the app-server thread contract. */
export const isCodexAppServerApprovalPolicy = (
  value: unknown,
): value is 'never' | 'on-request' | 'untrusted' =>
  value === 'never' || value === 'on-request' || value === 'untrusted';

/** Reviewers accepted by Codex, including the legacy `guardian_subagent` alias. */
export const isCodexApprovalsReviewer = (
  value: unknown,
): value is 'auto_review' | 'guardian_subagent' | 'user' =>
  value === 'user' || value === 'auto_review' || value === 'guardian_subagent';

export const isCodexSandboxMode = (value: unknown): value is CodexPermissionProfile['sandbox'] =>
  value === 'danger-full-access' || value === 'read-only' || value === 'workspace-write';

/**
 * Whether a saved preset needs the native approval bridge. Full access has a
 * lossless exec flag; legacy agents without a preset keep their original transport.
 */
export const codexPermissionModeRequiresAppServer = (mode: CodexPermissionMode | undefined) =>
  !!mode && mode !== 'full-access';

const unquoteCodexConfigValue = (value: string): string => {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return (quote === '"' || quote === "'") && trimmed.at(-1) === quote
    ? trimmed.slice(1, -1)
    : trimmed;
};

const parseCodexPermissionConfig = (
  assignment: string,
): { key: (typeof CODEX_PERMISSION_CONFIG_KEYS)[number]; value: string } | undefined => {
  const separator = assignment.indexOf('=');
  if (separator <= 0) return;
  const key = assignment.slice(0, separator).trim();
  if (!CODEX_PERMISSION_CONFIG_KEYS.includes(key as (typeof CODEX_PERMISSION_CONFIG_KEYS)[number]))
    return;

  return {
    key: key as (typeof CODEX_PERMISSION_CONFIG_KEYS)[number],
    value: unquoteCodexConfigValue(assignment.slice(separator + 1)),
  };
};

/** Remove every raw Codex permission override before applying a typed preset. */
export const stripCodexPermissionArgs = (args: string[] | undefined): string[] | undefined => {
  let stripped = stripCliFlags(args, [...CODEX_APPROVAL_FLAGS, ...CODEX_SANDBOX_FLAGS])?.filter(
    (arg) => arg !== CODEX_DANGEROUS_BYPASS_FLAG && arg !== CODEX_FULL_AUTO_FLAG,
  );
  for (const key of CODEX_PERMISSION_CONFIG_KEYS) stripped = stripCliConfigKey(stripped, key);
  return stripped;
};

/** Maps a saved preset to native approval, reviewer and sandbox fields. */
export const getCodexPermissionProfile = (mode: CodexPermissionMode): CodexPermissionProfile => {
  switch (mode) {
    case 'full-access': {
      return { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access' };
    }
    case 'auto-review': {
      return {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        sandbox: 'workspace-write',
      };
    }
    case 'ask': {
      return {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
      };
    }
    case 'read-only': {
      return { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' };
    }
    default: {
      throw new Error('Unsupported Codex permission mode');
    }
  }
};

/** Encodes a preset as native CLI arguments; the caller strips conflicting raw flags. */
export const getCodexPermissionModeArgs = (mode: CodexPermissionMode): string[] => {
  if (mode === 'full-access') return [CODEX_DANGEROUS_BYPASS_FLAG];

  const profile = getCodexPermissionProfile(mode);
  return [
    '--sandbox',
    profile.sandbox,
    '--ask-for-approval',
    profile.approvalPolicy,
    '-c',
    `approvals_reviewer="${profile.approvalsReviewer}"`,
  ];
};

/**
 * Parses the permission fields requested by raw Codex CLI arguments. This is the
 * only Codex permission parser: app-server thread params, the input bar and the
 * profile editor all read these fields.
 *
 * Use when: building native thread params or displaying a legacy configuration.
 * Expects: CLI arguments in their original order.
 * Returns: last-assigned fields; conflicting or expanded configurations are custom.
 */
export const parseCodexPermissionArgs = (args: string[] | undefined): CodexPermissionArgs => {
  args ??= [];

  let approvalPolicy: string | undefined;
  let approvalsReviewer: string | undefined;
  let invalid = false;
  let sandbox: string | undefined;
  let touched = false;

  const assign = (field: 'approval' | 'reviewer' | 'sandbox', value: string | undefined) => {
    touched = true;
    if (!value) {
      invalid = true;
      return;
    }
    const current =
      field === 'approval' ? approvalPolicy : field === 'reviewer' ? approvalsReviewer : sandbox;
    if (current && current !== value) invalid = true;
    if (field === 'approval') approvalPolicy = value;
    else if (field === 'reviewer') approvalsReviewer = value;
    else sandbox = value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === CODEX_DANGEROUS_BYPASS_FLAG) {
      assign('sandbox', 'danger-full-access');
      assign('approval', 'never');
      continue;
    }
    if (arg === CODEX_FULL_AUTO_FLAG) {
      assign('sandbox', 'workspace-write');
      assign('approval', 'on-request');
      continue;
    }

    const valueFlag = [...CODEX_APPROVAL_FLAGS, ...CODEX_SANDBOX_FLAGS].find(
      (flag) => arg === flag || arg.startsWith(`${flag}=`),
    );
    if (valueFlag) {
      const inline = arg.startsWith(`${valueFlag}=`);
      const value = inline ? arg.slice(valueFlag.length + 1) : args[index + 1];
      if (!inline && value) index += 1;
      assign(
        CODEX_APPROVAL_FLAGS.includes(valueFlag as (typeof CODEX_APPROVAL_FLAGS)[number])
          ? 'approval'
          : 'sandbox',
        value,
      );
      continue;
    }

    const configFlag = CODEX_CONFIG_FLAGS.find(
      (flag) => arg === flag || arg.startsWith(`${flag}=`),
    );
    if (!configFlag) continue;
    const inline = arg.startsWith(`${configFlag}=`);
    const assignment = inline ? arg.slice(configFlag.length + 1) : args[index + 1];
    if (!inline && assignment) index += 1;
    if (!assignment) {
      invalid = true;
      continue;
    }
    if (/^\s*(?:sandbox_workspace_write(?:\.|\s*=)|permissions(?:\.|\s*=))/.test(assignment))
      invalid = true;
    const config = parseCodexPermissionConfig(assignment);
    if (!config) continue;
    assign(
      config.key === 'approval_policy'
        ? 'approval'
        : config.key === 'approvals_reviewer'
          ? 'reviewer'
          : 'sandbox',
      config.value,
    );
  }

  approvalPolicy ??= 'never';
  sandbox ??= 'danger-full-access';
  const reviewer = approvalsReviewer ?? 'user';
  let mode: EffectiveCodexPermissionMode = 'custom';
  if (!invalid) {
    if (
      (!touched || sandbox === 'danger-full-access') &&
      approvalPolicy === 'never' &&
      reviewer === 'user'
    )
      mode = 'full-access';
    if (sandbox === 'workspace-write' && approvalPolicy === 'on-request')
      mode = reviewer === 'auto_review' ? 'auto-review' : reviewer === 'user' ? 'ask' : 'custom';
    if (sandbox === 'read-only' && approvalPolicy === 'on-request' && reviewer === 'user')
      mode = 'read-only';
  }
  return { approvalPolicy, approvalsReviewer: reviewer, mode, sandbox };
};

/**
 * Resolves the label shown for an agent's permissions. Legacy labels are for
 * display only: transport selection reads `permissionMode` directly.
 */
export const resolveCodexPermissionMode = ({
  args,
  permissionMode,
}: {
  args?: string[];
  permissionMode?: CodexPermissionMode;
}): ResolvedCodexPermissionMode =>
  permissionMode
    ? { mode: permissionMode, source: 'agent' }
    : { mode: parseCodexPermissionArgs(args).mode, source: 'legacy' };

type CodexExecPolicyAmendmentDecision = {
  acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] };
};

type CodexNetworkPolicyAmendmentDecision = {
  applyNetworkPolicyAmendment: {
    network_policy_amendment: { action: 'allow' | 'deny'; host: string };
  };
};

/**
 * A native command or file-change approval decision. Mirrors the generated
 * app-server `CommandExecutionApprovalDecision`; the heterogeneous-agents
 * package asserts the two stay identical.
 */
export type CodexApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'cancel'
  | 'decline'
  | CodexExecPolicyAmendmentDecision
  | CodexNetworkPolicyAmendmentDecision;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isExecPolicyAmendmentDecision = (
  decision: unknown,
): decision is CodexExecPolicyAmendmentDecision => {
  if (!isRecord(decision)) return false;
  const amendment = decision.acceptWithExecpolicyAmendment;
  return (
    isRecord(amendment) &&
    Array.isArray(amendment.execpolicy_amendment) &&
    amendment.execpolicy_amendment.every((part) => typeof part === 'string')
  );
};

const isNetworkPolicyAmendmentDecision = (
  decision: unknown,
): decision is CodexNetworkPolicyAmendmentDecision => {
  if (!isRecord(decision)) return false;
  const amendment = decision.applyNetworkPolicyAmendment;
  if (!isRecord(amendment) || !isRecord(amendment.network_policy_amendment)) return false;
  const policy = amendment.network_policy_amendment;
  return typeof policy.host === 'string' && (policy.action === 'allow' || policy.action === 'deny');
};

/** Validates an untrusted native or IPC payload as a complete approval decision. */
export const isCodexApprovalDecision = (decision: unknown): decision is CodexApprovalDecision =>
  decision === 'accept' ||
  decision === 'acceptForSession' ||
  decision === 'cancel' ||
  decision === 'decline' ||
  isExecPolicyAmendmentDecision(decision) ||
  isNetworkPolicyAmendmentDecision(decision);

/** Whether a decision withholds the requested permission. */
export const isCodexDenyDecision = (decision: unknown): boolean =>
  decision === 'cancel' ||
  decision === 'decline' ||
  (isNetworkPolicyAmendmentDecision(decision) &&
    decision.applyNetworkPolicyAmendment.network_policy_amendment.action === 'deny');

/** Native request context shown before authorizing a command or file change. */
export interface CodexApprovalArguments {
  availableDecisions?: unknown;
  /** Command awaiting approval, preserving the exact native text. */
  command?: string | null;
  /** Working directory in which the command will run. */
  cwd?: string | null;
  /** Directory whose write scope would be granted for this session. */
  grantRoot?: string | null;
  networkApprovalContext?: unknown;
  proposedExecpolicyAmendment?: unknown;
  proposedNetworkPolicyAmendments?: unknown;
  /** Native explanation for requesting expanded permission. */
  reason?: string | null;
}

/**
 * Identifies the native decision variant for presentation.
 *
 * Use when:
 * - Selecting a label for a validated decision.
 *
 * Expects:
 * - A supported native decision.
 *
 * Returns:
 * - Its string variant name.
 */
export const getCodexApprovalDecisionType = (decision: CodexApprovalDecision) => {
  if (typeof decision === 'string') return decision;
  return 'acceptWithExecpolicyAmendment' in decision
    ? 'acceptWithExecpolicyAmendment'
    : 'applyNetworkPolicyAmendment';
};

/**
 * Lists choices advertised by the native approval request.
 *
 * Use when:
 * - Rendering command or file-change approval actions.
 *
 * Expects:
 * - The native request context and tool API name.
 *
 * Returns:
 * - Advertised decisions, or compatible choices derived from native proposals.
 */
export const getCodexApprovalDecisions = (
  apiName: string | undefined,
  args: CodexApprovalArguments,
): CodexApprovalDecision[] => {
  if (Array.isArray(args.availableDecisions)) {
    return args.availableDecisions.filter(isCodexApprovalDecision);
  }

  // Decline rejects this operation; cancel aborts the native turn.
  if (apiName === 'file_change') return ['accept', 'acceptForSession', 'decline'];

  const decisions: CodexApprovalDecision[] = ['accept'];
  if (isRecord(args.networkApprovalContext)) {
    decisions.push('acceptForSession');
    if (Array.isArray(args.proposedNetworkPolicyAmendments)) {
      const policy = args.proposedNetworkPolicyAmendments.find(
        (amendment) => isRecord(amendment) && amendment.action === 'allow',
      );
      if (isRecord(policy) && typeof policy.host === 'string') {
        decisions.push({
          applyNetworkPolicyAmendment: {
            network_policy_amendment: { action: 'allow', host: policy.host },
          },
        });
      }
    }
  } else if (
    Array.isArray(args.proposedExecpolicyAmendment) &&
    args.proposedExecpolicyAmendment.every((part) => typeof part === 'string')
  ) {
    decisions.push({
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: args.proposedExecpolicyAmendment,
      },
    });
  }
  decisions.push('decline');
  return decisions;
};
