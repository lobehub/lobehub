/**
 * Heterogeneous-agent descriptor.
 *
 * `getAgentDetail` is called by an orchestrator agent (e.g. LobeAI) to decide
 * whether a target agent is fit for a job — typically "can this agent fix a bug
 * in a real codebase?". For a normal model-backed agent the answer lives in
 * `model` / `provider` / `plugins`. For a **heterogeneous** agent (an external
 * CLI/runtime such as Claude Code or Codex) those fields are misleading: the
 * agent brings its own toolset and ignores the plugin list, so we must instead
 * describe what the external runtime is and what it can do.
 *
 * This module maps a `LobeAgentAgencyConfig` into a compact, LLM-facing runtime
 * descriptor plus a few human-readable lines for the tool `content`.
 */
import type {
  DeviceExecutionTarget,
  HeterogeneousProviderConfig,
  LobeAgentAgencyConfig,
} from '@lobechat/types';

type HeteroType = HeterogeneousProviderConfig['type'];

interface HeteroTypeProfile {
  /** High-level capability tags the orchestrator can reason over. */
  capabilities: string[];
  /** One-paragraph capability summary written for the orchestrator LLM. */
  description: string;
  /** Friendly product name. */
  displayName: string;
  /** Local child-process CLI vs. an agent dispatched to a remote device. */
  kind: 'cli' | 'remote';
}

const CODING_CAPABILITIES = [
  'filesystem-read',
  'filesystem-write',
  'shell-commands',
  'code-search',
  'multi-step-autonomy',
];

const HETERO_PROFILES: Record<HeteroType, HeteroTypeProfile> = {
  'amp': {
    capabilities: CODING_CAPABILITIES,
    description:
      "Amp — Sourcegraph's autonomous coding agent. Reads, edits and writes files, runs shell commands and works across a real codebase to complete software-engineering tasks.",
    displayName: 'Amp',
    kind: 'cli',
  },
  'claude-code': {
    capabilities: CODING_CAPABILITIES,
    description:
      "Claude Code — Anthropic's autonomous CLI coding agent. It has full access to a working directory: it can read, edit and write files, run shell commands and tests, search the codebase, and carry multi-step software-engineering tasks (bug fixes, feature work, refactors) end to end on its own. It does NOT use the chat `plugins`/`model` settings — it runs its own built-in toolset and model.",
    displayName: 'Claude Code',
    kind: 'cli',
  },
  'codex': {
    capabilities: CODING_CAPABILITIES,
    description:
      "Codex — OpenAI's autonomous CLI coding agent. It has full access to a working directory: it can read, edit and write files, run shell commands and tests, and complete multi-step software-engineering tasks autonomously. It does NOT use the chat `plugins`/`model` settings — it runs its own built-in toolset and model.",
    displayName: 'Codex',
    kind: 'cli',
  },
  'hermes': {
    capabilities: CODING_CAPABILITIES,
    description:
      'Hermes — a remote autonomous agent runtime that runs on a connected device and can read, edit and write files and run commands in its workspace.',
    displayName: 'Hermes',
    kind: 'remote',
  },
  'opencode': {
    capabilities: CODING_CAPABILITIES,
    description:
      'OpenCode — an open-source terminal coding agent with filesystem and shell access that completes software-engineering tasks autonomously.',
    displayName: 'OpenCode',
    kind: 'cli',
  },
  'openclaw': {
    capabilities: CODING_CAPABILITIES,
    description:
      'OpenClaw — a remote autonomous agent platform. It runs on a connected device with full filesystem and shell access to its workspace.',
    displayName: 'OpenClaw',
    kind: 'remote',
  },
};

const EXECUTION_TARGET_DESCRIPTIONS: Record<DeviceExecutionTarget, string> = {
  auto: 'auto-selected online device (one is activated automatically; with several the agent picks one)',
  device: 'a specific device connected via `lh connect`',
  local: "in-process on the user's desktop",
  none: 'no execution environment (plain chat)',
  sandbox: 'a server-spawned cloud sandbox',
};

/**
 * LLM-facing runtime descriptor for a heterogeneous agent. Surfaced in
 * `GetAgentDetailState.config.runtime`.
 */
export interface HeteroAgentRuntimeDescriptor {
  /** Device this agent is bound to, when `executionTarget === 'device'`. */
  boundDeviceId?: string;
  /** High-level capability tags. */
  capabilities: string[];
  /** Human-readable capability summary for the orchestrator. */
  description: string;
  /** Friendly product name (e.g. "Claude Code"). */
  displayName: string;
  /** Where the agent executes. */
  executionTarget?: DeviceExecutionTarget;
  /** Local CLI child-process vs. remote device runtime. */
  kind: 'cli' | 'remote';
  /** Runtime type identifier (e.g. `claude-code`, `codex`). */
  type: HeteroType;
}

/**
 * Build a runtime descriptor for a heterogeneous agent, or `undefined` when the
 * agent is a normal model-backed chat agent (no `heterogeneousProvider`).
 */
export const describeHeterogeneousAgent = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
): HeteroAgentRuntimeDescriptor | undefined => {
  const provider = agencyConfig?.heterogeneousProvider;
  if (!provider?.type) return undefined;

  const profile = HETERO_PROFILES[provider.type];
  if (!profile) return undefined;

  return {
    boundDeviceId: agencyConfig?.boundDeviceId,
    capabilities: profile.capabilities,
    description: profile.description,
    displayName: profile.displayName,
    executionTarget: agencyConfig?.executionTarget,
    kind: profile.kind,
    type: provider.type,
  };
};

/**
 * Render the runtime descriptor into human-readable lines for the tool
 * `content`. Returns an empty array for non-hetero agents.
 */
export const renderHeteroRuntimeLines = (
  descriptor: HeteroAgentRuntimeDescriptor | undefined,
): string[] => {
  if (!descriptor) return [];

  const lines: string[] = [
    `Runtime: ${descriptor.displayName} (heterogeneous \`${descriptor.type}\` agent — ignores the chat model/plugins settings above)`,
    descriptor.description,
  ];

  if (descriptor.executionTarget) {
    const where = EXECUTION_TARGET_DESCRIPTIONS[descriptor.executionTarget];
    lines.push(
      `Runs on: ${where}${
        descriptor.executionTarget === 'device' && descriptor.boundDeviceId
          ? ` (deviceId: ${descriptor.boundDeviceId})`
          : ''
      }`,
    );
  }

  return lines;
};
