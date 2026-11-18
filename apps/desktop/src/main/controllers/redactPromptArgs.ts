import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';

/** Hide a prompt passed on argv from logs and traces. */
export const redactPromptArgs = (args: string[], agentType: HeterogeneousAgentType): string[] => {
  let redactNext = false;
  const supportsShortPromptFlag = agentType === 'kimi-code';

  return args.map((arg) => {
    if (redactNext) {
      redactNext = false;
      return '[REDACTED]';
    }

    if (arg === '--prompt' || (supportsShortPromptFlag && arg === '-p')) {
      redactNext = true;
      return arg;
    }

    if (arg.startsWith('--prompt=')) return '--prompt=[REDACTED]';
    if (supportsShortPromptFlag && arg.startsWith('-p=')) return '-p=[REDACTED]';

    return arg;
  });
};
