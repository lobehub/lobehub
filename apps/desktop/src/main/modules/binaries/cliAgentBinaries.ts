import type { LocalHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import {
  detectHeterogeneousCliCommand,
  detectValidatedCommand,
} from '@lobechat/heterogeneous-agents/resolveCliCommand';

import type { BinarySpec, BinaryStatus } from '@/core/infrastructure/BinaryManager';
import { defineCommandBinary } from '@/core/infrastructure/BinaryManager';

// The command-resolution + validation logic (which/where lookup, login-shell
// PATH retry, well-known install fallbacks incl. app-bundled Codex CLIs,
// `--version` keyword validation) lives in the shared `@lobechat/heterogeneous-
// agents` package so the desktop manager path and the `lh hetero exec` CLI /
// sandbox path resolve binaries identically. This module only adapts it into
// the desktop `BinarySpec` shape.
export {
  detectHeterogeneousCliCommand,
  invalidateLoginShellPathCache,
} from '@lobechat/heterogeneous-agents/resolveCliCommand';

interface ValidatedBinaryOptions {
  candidates: string[];
  description: string;
  name: string;
  priority: number;
  validateFlag?: string;
  validateKeywords: string[];
}

/**
 * Binary spec that resolves a command path via which/where, then validates
 * the binary by matching `--version` (or `--help`) output against a keyword
 * to avoid collisions with unrelated executables of the same name.
 */
const defineValidatedBinary = (options: ValidatedBinaryOptions): BinarySpec => {
  const { candidates, description, name, priority, ...validation } = options;

  return {
    description,
    async detect(): Promise<BinaryStatus> {
      for (const cmd of candidates) {
        const status = await detectValidatedCommand(cmd, validation);
        if (status.available) return status;
      }

      return { available: false };
    },
    name,
    priority,
  };
};

/**
 * Claude Code CLI
 * @see https://docs.claude.com/en/docs/claude-code
 *
 * Goes through `detectHeterogeneousCliCommand` so Finder/launchd-started
 * desktop builds can still discover user-local installs such as
 * `~/.local/bin/claude` when that directory is absent from the inherited PATH.
 */
export const claudeCodeBinary: BinarySpec = {
  description: 'Claude Code - Anthropic official agentic coding CLI',
  detect: () => detectHeterogeneousCliCommand('claude-code', 'claude'),
  name: 'claude',
  priority: 1,
};

/** Tencent CodeBuddy CLI @see https://www.codebuddy.ai/docs/cli/installation */
export const codeBuddyBinary: BinarySpec = {
  description: 'CodeBuddy - Tencent agentic coding CLI',
  detect: () => detectHeterogeneousCliCommand('codebuddy', 'codebuddy'),
  name: 'codebuddy',
  priority: 2,
};

/**
 * OpenAI Codex CLI
 * @see https://github.com/openai/codex
 *
 * Goes through `detectHeterogeneousCliCommand` so the app-bundled CLI
 * fallback applies here too, keeping the manager path and the custom-command
 * path in sync.
 */
export const codexBinary: BinarySpec = {
  description: 'Codex - OpenAI agentic coding CLI',
  detect: () => detectHeterogeneousCliCommand('codex', 'codex'),
  name: 'codex',
  priority: 2,
};

/** Cursor Agent CLI @see https://cursor.com/docs/cli/installation */
export const cursorBinary: BinarySpec = {
  description: 'Cursor - Cursor agentic coding CLI',
  detect: () => detectHeterogeneousCliCommand('cursor', 'agent'),
  name: 'agent',
  priority: 3,
};

/** Factory Droid CLI @see https://docs.factory.ai/cli/getting-started/quickstart */
export const droidBinary: BinarySpec = {
  description: 'Factory Droid - Factory agentic coding CLI',
  detect: () => detectHeterogeneousCliCommand('droid', 'droid'),
  name: 'droid',
  priority: 3,
};

/** xAI Grok Build CLI @see https://docs.x.ai/build/overview */
export const grokBuildBinary: BinarySpec = {
  description: 'Grok Build - xAI agentic coding CLI',
  detect: () => detectHeterogeneousCliCommand('grok-build', 'grok'),
  name: 'grok',
  priority: 3,
};

/**
 * Amp CLI
 * @see https://ampcode.com/manual
 */
export const ampBinary: BinarySpec = {
  description: 'Amp - Sourcegraph agentic coding CLI',
  detect: () => detectHeterogeneousCliCommand('amp', 'amp'),
  name: 'amp',
  priority: 3,
};

/**
 * OpenCode CLI
 * @see https://opencode.ai/docs
 */
export const opencodeBinary: BinarySpec = {
  description: 'OpenCode - Open source agentic coding CLI',
  detect: () => detectHeterogeneousCliCommand('opencode', 'opencode'),
  name: 'opencode',
  priority: 4,
};

/**
 * Pi coding agent CLI
 * @see https://github.com/earendil-works/pi
 */
export const piBinary: BinarySpec = {
  description: 'Pi - Minimal coding agent CLI',
  detect: () => detectHeterogeneousCliCommand('pi', 'pi'),
  name: 'pi',
  priority: 5,
};

/** Qoder CLI @see https://docs.qoder.com/cli/install.md */
export const qoderBinary: BinarySpec = {
  description: 'Qoder - AI coding agent CLI',
  detect: () => detectHeterogeneousCliCommand('qoder', 'qodercli'),
  name: 'qodercli',
  priority: 6,
};

/** TRAE Enterprise CLI, capability-checked against its ACP runtime. */
export const traeBinary: BinarySpec = {
  description: 'TRAE CLI - ByteDance enterprise agentic coding CLI',
  detect: () => detectHeterogeneousCliCommand('trae', 'traecli'),
  name: 'traecli',
  priority: 7,
};

/**
 * Google Gemini CLI
 * @see https://github.com/google-gemini/gemini-cli
 */
export const geminiCliBinary: BinarySpec = defineValidatedBinary({
  candidates: ['gemini'],
  description: 'Gemini CLI - Google agentic coding CLI',
  name: 'gemini',
  priority: 8,
  validateKeywords: ['gemini'],
});

/**
 * Qwen Code CLI
 * @see https://github.com/QwenLM/qwen-code
 */
export const qwenCodeBinary: BinarySpec = defineValidatedBinary({
  candidates: ['qwen'],
  description: 'Qwen Code - Alibaba Qwen agentic coding CLI',
  name: 'qwen',
  priority: 9,
  validateKeywords: ['qwen'],
});

/**
 * Kimi Code (Moonshot AI)
 * @see https://github.com/MoonshotAI/kimi-code
 */
export const kimiCliBinary: BinarySpec = {
  description: 'Kimi Code - Moonshot AI agentic coding CLI',
  detect: () => detectHeterogeneousCliCommand('kimi-code', 'kimi'),
  name: 'kimi',
  priority: 10,
};

/**
 * Aider - AI pair programming CLI
 * Generic command spec; name collision is unlikely.
 * @see https://github.com/Aider-AI/aider
 */
export const aiderBinary: BinarySpec = defineCommandBinary('aider', {
  description: 'Aider - AI pair programming in your terminal',
  priority: 11,
});

/**
 * All CLI agent binaries
 */
export const heterogeneousCliAgentBinaries = {
  'amp': ampBinary,
  'claude-code': claudeCodeBinary,
  'codebuddy': codeBuddyBinary,
  'codex': codexBinary,
  'cursor': cursorBinary,
  'droid': droidBinary,
  'grok-build': grokBuildBinary,
  'kimi-code': kimiCliBinary,
  'opencode': opencodeBinary,
  'pi': piBinary,
  'qoder': qoderBinary,
  'trae': traeBinary,
} satisfies Record<LocalHeterogeneousAgentType, BinarySpec>;

export const cliAgentBinaries: BinarySpec[] = [
  ...Object.values(heterogeneousCliAgentBinaries),
  geminiCliBinary,
  qwenCodeBinary,
  aiderBinary,
];

export const listHeterogeneousCliBinaryTypes = (): LocalHeterogeneousAgentType[] =>
  Object.keys(heterogeneousCliAgentBinaries) as LocalHeterogeneousAgentType[];
