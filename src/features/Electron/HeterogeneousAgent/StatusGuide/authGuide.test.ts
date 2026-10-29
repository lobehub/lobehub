import { describe, expect, it } from 'vitest';

import { resolveAuthGuideCopy } from './authGuide';

describe('resolveAuthGuideCopy', () => {
  it('sends a web Copilot run to its own sign-in on the device, without the cloud token', () => {
    expect(resolveAuthGuideCopy('copilot', false)).toEqual({
      afterLoginKey: 'cliAuthGuide.deviceAfterLogin',
      showSignInCommand: true,
    });
  });

  it('keeps the cloud credential update for Claude Code on the web', () => {
    expect(resolveAuthGuideCopy('claude-code', false)).toEqual({
      afterLoginKey: 'cliAuthGuide.cloudAfterUpdate',
      showSignInCommand: false,
      systemToolsLabelKey: 'cliAuthGuide.actions.openCloudCredentials',
    });
  });

  it.each(['claude-code', 'copilot'] as const)(
    'signs %s in locally on the desktop',
    (agentType) => {
      expect(resolveAuthGuideCopy(agentType, true)).toEqual({
        afterLoginKey: 'cliAuthGuide.afterLogin',
        showSignInCommand: true,
        systemToolsLabelKey: 'cliAuthGuide.actions.openSystemTools',
      });
    },
  );
});
