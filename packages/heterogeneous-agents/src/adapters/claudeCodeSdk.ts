import { ClaudeCodeAdapter } from './claudeCode';

/**
 * Claude Code over the Agent SDK transport. One Query can report several
 * `result`s, so runtime end comes from the transport closing.
 */
export class ClaudeCodeSdkAdapter extends ClaudeCodeAdapter {
  constructor() {
    super({
      runtimeEndStrategy: 'on-transport-close',
      signalBackgroundTaskCompletion: true,
    });
  }
}
