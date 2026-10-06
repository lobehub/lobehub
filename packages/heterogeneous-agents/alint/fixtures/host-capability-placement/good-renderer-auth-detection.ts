// Fixture: src/config.ts — CLI descriptors the desktop renderer uses to drive the CLI over IPC and read its stderr.
export interface HeterogeneousAgentDescriptor {
  authPatterns: RegExp[];
  defaultCommand: string;
  installDocsUrl: string;
}

export const DESCRIPTORS: Record<string, HeterogeneousAgentDescriptor> = {
  'claude-code': {
    authPatterns: [/please run \/login/i, /invalid api key/i],
    defaultCommand: 'claude',
    installDocsUrl: 'https://docs.anthropic.com/claude-code',
  },
};

export const resolveHeterogeneousAgentCommand = (agentType: string, command?: string) =>
  command?.trim() || DESCRIPTORS[agentType]?.defaultCommand;

export const isHeterogeneousAgentAuthRequired = (agentType: string, stderr: string) =>
  DESCRIPTORS[agentType]?.authPatterns.some((pattern) => pattern.test(stderr)) ?? false;
