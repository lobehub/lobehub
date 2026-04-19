import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

import type { IToolDetector, ToolStatus } from '@/core/infrastructure/ToolDetectorManager';
import { createCommandDetector } from '@/core/infrastructure/ToolDetectorManager';

const execPromise = promisify(exec);

/**
 * Detector that resolves a command path via which/where, then validates
 * the binary by matching `--version` (or `--help`) output against a keyword
 * to avoid collisions with unrelated executables of the same name.
 */
const createValidatedDetector = (options: {
  candidates: string[];
  description: string;
  name: string;
  priority: number;
  validateFlag?: string;
  validateKeywords: string[];
}): IToolDetector => {
  const {
    name,
    description,
    priority,
    candidates,
    validateFlag = '--version',
    validateKeywords,
  } = options;

  return {
    description,
    async detect(): Promise<ToolStatus> {
      const whichCmd = platform() === 'win32' ? 'where' : 'which';

      for (const cmd of candidates) {
        try {
          const { stdout: pathOut } = await execPromise(`${whichCmd} ${cmd}`, { timeout: 3000 });
          const toolPath = pathOut.trim().split('\n')[0];
          if (!toolPath) continue;

          const { stdout: out } = await execPromise(`${cmd} ${validateFlag}`, { timeout: 5000 });
          const output = out.trim();
          const lowered = output.toLowerCase();
          if (!validateKeywords.some((kw) => lowered.includes(kw.toLowerCase()))) continue;

          return {
            available: true,
            path: toolPath,
            version: output.split('\n')[0],
          };
        } catch {
          continue;
        }
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
 */
export const claudeCodeDetector: IToolDetector = createValidatedDetector({
  candidates: ['claude'],
  description: 'Claude Code - Anthropic official agentic coding CLI',
  name: 'claude',
  priority: 1,
  validateKeywords: ['claude code'],
});

/**
 * OpenAI Codex CLI
 * @see https://github.com/openai/codex
 */
export const codexDetector: IToolDetector = createValidatedDetector({
  candidates: ['codex'],
  description: 'Codex - OpenAI agentic coding CLI',
  name: 'codex',
  priority: 2,
  validateKeywords: ['codex'],
});

/**
 * Google Gemini CLI
 * @see https://github.com/google-gemini/gemini-cli
 */
export const geminiCliDetector: IToolDetector = createValidatedDetector({
  candidates: ['gemini'],
  description: 'Gemini CLI - Google agentic coding CLI',
  name: 'gemini',
  priority: 3,
  validateKeywords: ['gemini'],
});

/**
 * Qwen Code CLI
 * @see https://github.com/QwenLM/qwen-code
 */
export const qwenCodeDetector: IToolDetector = createValidatedDetector({
  candidates: ['qwen'],
  description: 'Qwen Code - Alibaba Qwen agentic coding CLI',
  name: 'qwen',
  priority: 4,
  validateKeywords: ['qwen'],
});

/**
 * Kimi CLI (Moonshot)
 * @see https://github.com/MoonshotAI/kimi-cli
 */
export const kimiCliDetector: IToolDetector = createValidatedDetector({
  candidates: ['kimi'],
  description: 'Kimi CLI - Moonshot AI agentic coding CLI',
  name: 'kimi',
  priority: 5,
  validateKeywords: ['kimi'],
});

/**
 * Aider - AI pair programming CLI
 * Generic command detector; name collision is unlikely.
 * @see https://github.com/Aider-AI/aider
 */
export const aiderDetector: IToolDetector = createCommandDetector('aider', {
  description: 'Aider - AI pair programming in your terminal',
  priority: 6,
});

/**
 * All CLI agent detectors
 */
export const cliAgentDetectors: IToolDetector[] = [
  claudeCodeDetector,
  codexDetector,
  geminiCliDetector,
  qwenCodeDetector,
  kimiCliDetector,
  aiderDetector,
];
