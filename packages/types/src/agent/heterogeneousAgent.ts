import type { TopicGroupMode } from '../topic/topic';

export interface HeterogeneousAgentAuthDescriptor {
  docsUrl: string;
  errorMessage: string;
  /** Case-insensitive RegExp sources used to recognize authentication failures. */
  patterns: readonly string[];
  signInCommand: string;
}

export interface HeterogeneousAgentInstallDescriptor {
  commands: readonly string[];
  docsUrl: string;
}

/**
 * Static, serializable source of truth for a local heterogeneous CLI agent.
 * Runtime adapters and drivers remain provider-specific; identity and host
 * metadata must be added here exactly once.
 */
export interface LocalHeterogeneousAgentDescriptor {
  auth: HeterogeneousAgentAuthDescriptor;
  defaultCommand: string;
  /**
   * Topic-list grouping the agent's conversations fall back to when neither the
   * agent nor the user has pinned an explicit mode. CLI agents run anchored to a
   * working directory, so folder-based `byProject` grouping is the natural
   * default for them. Omit to inherit the global user preference.
   */
  defaultTopicGroupMode?: TopicGroupMode;
  iconId: string;
  install: HeterogeneousAgentInstallDescriptor;
  kind: 'local-cli';
  menuKey: string;
  menuLabelKey: string;
  resume: { supported: boolean };
  title: string;
  type: string;
}

const COMMON_AUTH_REQUIRED_PATTERNS = [
  'failed to authenticate',
  'invalid authentication credentials',
  'authentication[_ ]error',
  'not authenticated',
  '\\bunauthorized\\b',
  '\\b401\\b',
  'no api key found',
  'no models available',
] as const;

export const HETEROGENEOUS_AGENT_CONFIGS = [
  {
    auth: {
      docsUrl: 'https://ampcode.com/manual',
      errorMessage:
        'Amp could not authenticate. Run `amp login` or configure AMP_API_KEY, then retry.',
      patterns: [...COMMON_AUTH_REQUIRED_PATTERNS, 'please (?:log|sign) in', 'amp_api_key'],
      signInCommand: 'amp login',
    },
    defaultCommand: 'amp',
    defaultTopicGroupMode: 'byProject',
    iconId: 'Amp',
    install: {
      commands: [
        'curl -fsSL https://ampcode.com/install.sh | bash',
        'brew install ampcode/tap/ampcode',
      ],
      docsUrl: 'https://ampcode.com/manual',
    },
    kind: 'local-cli',
    menuKey: 'newAmpAgent',
    menuLabelKey: 'newAmpAgent',
    resume: { supported: true },
    title: 'Amp',
    type: 'amp',
  },
  {
    auth: {
      docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
      errorMessage:
        'Claude Code could not authenticate. Sign in again or refresh its credentials, then retry.',
      // Current Claude Code builds can emit this as plain process output before
      // the structured result event reaches the adapter. Keep it in the shared
      // process classifier so server-side `heteroFinish` can still recover the
      // dedicated auth-required error card from a flattened payload.
      patterns: [...COMMON_AUTH_REQUIRED_PATTERNS, 'not logged in'],
      signInCommand: 'claude',
    },
    defaultCommand: 'claude',
    defaultTopicGroupMode: 'byProject',
    iconId: 'ClaudeCode',
    install: {
      commands: [
        'curl -fsSL https://claude.ai/install.sh | bash',
        'brew install --cask claude-code',
      ],
      docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    },
    kind: 'local-cli',
    menuKey: 'newClaudeCodeAgent',
    menuLabelKey: 'newClaudeCodeAgent',
    resume: { supported: true },
    title: 'Claude Code',
    type: 'claude-code',
  },
  {
    auth: {
      docsUrl: 'https://www.codebuddy.ai/docs/cli/installation',
      errorMessage: 'CodeBuddy could not authenticate. Run `codebuddy`, use `/login`, then retry.',
      patterns: [
        ...COMMON_AUTH_REQUIRED_PATTERNS,
        'authentication required',
        'please use \\/login',
        'not logged in',
      ],
      signInCommand: 'codebuddy',
    },
    defaultCommand: 'codebuddy',
    defaultTopicGroupMode: 'byProject',
    iconId: 'CodeBuddy',
    install: {
      commands: [
        'npm install -g @tencent-ai/codebuddy-code',
        'brew install Tencent-CodeBuddy/tap/codebuddy-code',
      ],
      docsUrl: 'https://www.codebuddy.ai/docs/cli/installation',
    },
    kind: 'local-cli',
    menuKey: 'newCodeBuddyAgent',
    menuLabelKey: 'newCodeBuddyAgent',
    resume: { supported: true },
    title: 'CodeBuddy',
    type: 'codebuddy',
  },
  {
    auth: {
      docsUrl: 'https://github.com/openai/codex#installing-and-running-codex-cli',
      errorMessage:
        'Codex could not authenticate. Sign in again or refresh its credentials, then retry.',
      patterns: COMMON_AUTH_REQUIRED_PATTERNS,
      signInCommand: 'codex',
    },
    defaultCommand: 'codex',
    defaultTopicGroupMode: 'byProject',
    iconId: 'Codex',
    install: {
      commands: ['npm install -g @openai/codex', 'brew install --cask codex'],
      docsUrl: 'https://github.com/openai/codex#installing-and-running-codex-cli',
    },
    kind: 'local-cli',
    menuKey: 'newCodexAgent',
    menuLabelKey: 'newCodexAgent',
    resume: { supported: true },
    title: 'Codex',
    type: 'codex',
  },
  {
    auth: {
      docsUrl: 'https://cursor.com/docs/cli/installation',
      errorMessage: 'Cursor could not authenticate. Run `agent login`, then retry.',
      patterns: [...COMMON_AUTH_REQUIRED_PATTERNS, 'authentication required', 'not logged in'],
      signInCommand: 'agent login',
    },
    defaultCommand: 'agent',
    defaultTopicGroupMode: 'byProject',
    iconId: 'Cursor',
    install: {
      commands: ['curl https://cursor.com/install -fsS | bash'],
      docsUrl: 'https://cursor.com/docs/cli/installation',
    },
    kind: 'local-cli',
    menuKey: 'newCursorAgent',
    menuLabelKey: 'newCursorAgent',
    resume: { supported: true },
    title: 'Cursor',
    type: 'cursor',
  },
  {
    auth: {
      docsUrl: 'https://moonshotai.github.io/kimi-code/en/',
      errorMessage: 'Kimi Code could not authenticate. Run `kimi`, use `/login`, then retry.',
      patterns: [...COMMON_AUTH_REQUIRED_PATTERNS, 'no model configured'],
      signInCommand: 'kimi',
    },
    defaultCommand: 'kimi',
    defaultTopicGroupMode: 'byProject',
    iconId: 'Kimi',
    install: {
      commands: [
        'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
        'irm https://code.kimi.com/kimi-code/install.ps1 | iex',
      ],
      docsUrl: 'https://moonshotai.github.io/kimi-code/en/',
    },
    kind: 'local-cli',
    menuKey: 'newKimiCodeAgent',
    menuLabelKey: 'newKimiCodeAgent',
    resume: { supported: true },
    title: 'Kimi Code',
    type: 'kimi-code',
  },
  {
    auth: {
      docsUrl: 'https://opencode.ai/docs',
      errorMessage:
        'OpenCode could not authenticate. Sign in again or refresh its credentials, then retry.',
      patterns: [
        ...COMMON_AUTH_REQUIRED_PATTERNS,
        'authentication',
        'invalid.*(?:credential|token|key)',
      ],
      signInCommand: 'opencode auth login',
    },
    defaultCommand: 'opencode',
    defaultTopicGroupMode: 'byProject',
    iconId: 'OpenCode',
    install: {
      commands: ['curl -fsSL https://opencode.ai/install | bash'],
      docsUrl: 'https://opencode.ai/docs',
    },
    kind: 'local-cli',
    menuKey: 'newOpenCodeAgent',
    menuLabelKey: 'newOpenCodeAgent',
    resume: { supported: true },
    title: 'OpenCode',
    type: 'opencode',
  },
  {
    auth: {
      docsUrl: 'https://github.com/earendil-works/pi',
      errorMessage: 'Pi could not authenticate. Run `pi`, use `/login`, then retry.',
      patterns: [
        ...COMMON_AUTH_REQUIRED_PATTERNS,
        'invalid (?:authentication )?(?:credentials?|tokens?|api keys?)',
      ],
      signInCommand: 'pi',
    },
    defaultCommand: 'pi',
    defaultTopicGroupMode: 'byProject',
    iconId: 'Pi',
    install: {
      commands: ['npm install -g @earendil-works/pi-coding-agent'],
      docsUrl: 'https://github.com/earendil-works/pi',
    },
    kind: 'local-cli',
    menuKey: 'newPiAgent',
    menuLabelKey: 'newPiAgent',
    resume: { supported: true },
    title: 'Pi',
    type: 'pi',
  },
  {
    auth: {
      docsUrl: 'https://docs.qoder.com/cli/auth.md',
      errorMessage: 'Qoder could not authenticate. Run `qodercli login`, then retry.',
      patterns: [...COMMON_AUTH_REQUIRED_PATTERNS, 'not logged in', 'please run \\/login'],
      signInCommand: 'qodercli login',
    },
    defaultCommand: 'qodercli',
    defaultTopicGroupMode: 'byProject',
    iconId: 'Qoder',
    install: {
      commands: [
        'curl -fsSL https://qoder.com/install | bash',
        'npm install -g @qoder-ai/qodercli',
      ],
      docsUrl: 'https://docs.qoder.com/cli/install.md',
    },
    kind: 'local-cli',
    menuKey: 'newQoderAgent',
    menuLabelKey: 'newQoderAgent',
    resume: { supported: true },
    title: 'Qoder',
    type: 'qoder',
  },
] as const satisfies readonly LocalHeterogeneousAgentDescriptor[];

export interface RemoteHeterogeneousAgentDescriptor {
  kind: 'remote-task';
  title: string;
  type: string;
}

export const REMOTE_HETEROGENEOUS_AGENT_CONFIGS = [
  { kind: 'remote-task', title: 'OpenClaw', type: 'openclaw' },
  { kind: 'remote-task', title: 'Hermes', type: 'hermes' },
] as const satisfies readonly RemoteHeterogeneousAgentDescriptor[];

export type HeterogeneousAgentDescriptor =
  | (typeof HETEROGENEOUS_AGENT_CONFIGS)[number]
  | (typeof REMOTE_HETEROGENEOUS_AGENT_CONFIGS)[number];

export type HeterogeneousAgentMenuLabelKey =
  (typeof HETEROGENEOUS_AGENT_CONFIGS)[number]['menuLabelKey'];
export type LocalHeterogeneousAgentType = (typeof HETEROGENEOUS_AGENT_CONFIGS)[number]['type'];
export type RemoteHeterogeneousAgentType =
  (typeof REMOTE_HETEROGENEOUS_AGENT_CONFIGS)[number]['type'];
export type HeterogeneousAgentType = LocalHeterogeneousAgentType | RemoteHeterogeneousAgentType;
