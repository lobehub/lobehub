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
export { detectHeterogeneousCliCommand } from '@lobechat/heterogeneous-agents/resolveCliCommand';

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
 * Google Gemini CLI
 * @see https://github.com/google-gemini/gemini-cli
 */
export const geminiCliBinary: BinarySpec = defineValidatedBinary({
  candidates: ['gemini'],
  description: 'Gemini CLI - Google agentic coding CLI',
  name: 'gemini',
  priority: 4,
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
  priority: 5,
  validateKeywords: ['qwen'],
});

/**
 * Kimi CLI (Moonshot)
 * @see https://github.com/MoonshotAI/kimi-cli
 */
export const kimiCliBinary: BinarySpec = defineValidatedBinary({
  candidates: ['kimi'],
  description: 'Kimi CLI - Moonshot AI agentic coding CLI',
  name: 'kimi',
  priority: 6,
  validateKeywords: ['kimi'],
});

/**
 * Aider - AI pair programming CLI
 * Generic command spec; name collision is unlikely.
 * @see https://github.com/Aider-AI/aider
 */
export const aiderBinary: BinarySpec = defineCommandBinary('aider', {
  description: 'Aider - AI pair programming in your terminal',
  priority: 7,
});

/**
 * All CLI agent binaries
 */
export const cliAgentBinaries: BinarySpec[] = [
  claudeCodeBinary,
  codexBinary,
  ampBinary,
  geminiCliBinary,
  qwenCodeBinary,
  kimiCliBinary,
  aiderBinary,
];
