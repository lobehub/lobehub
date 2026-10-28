import type { SupportedHeterogeneousAgentType } from './types';

export interface AuthGuideCopy {
  /** Footer telling the user what to do once signed in. */
  afterLoginKey:
    'cliAuthGuide.afterLogin' | 'cliAuthGuide.cloudAfterUpdate' | 'cliAuthGuide.deviceAfterLogin';
  /** Whether the CLI's own sign-in command applies. */
  showSignInCommand: boolean;
  /** Label of the secondary action; absent when the surface has nothing to open. */
  systemToolsLabelKey?:
    'cliAuthGuide.actions.openCloudCredentials' | 'cliAuthGuide.actions.openSystemTools';
}

/**
 * Where an agent that lost its sign-in signs in again. The desktop runs the CLI
 * locally. On the web only Claude Code has a cloud token to update; every other
 * agent runs on a connected device and signs in there with its own command.
 */
export const resolveAuthGuideCopy = (
  agentType: SupportedHeterogeneousAgentType,
  desktop: boolean,
): AuthGuideCopy => {
  if (desktop)
    return {
      afterLoginKey: 'cliAuthGuide.afterLogin',
      showSignInCommand: true,
      systemToolsLabelKey: 'cliAuthGuide.actions.openSystemTools',
    };

  if (agentType === 'claude-code')
    return {
      afterLoginKey: 'cliAuthGuide.cloudAfterUpdate',
      showSignInCommand: false,
      systemToolsLabelKey: 'cliAuthGuide.actions.openCloudCredentials',
    };

  return { afterLoginKey: 'cliAuthGuide.deviceAfterLogin', showSignInCommand: true };
};
