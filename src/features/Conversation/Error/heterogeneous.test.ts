import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import { isHeterogeneousAgentStatusGuideError } from './heterogeneous';

describe('isHeterogeneousAgentStatusGuideError', () => {
  it.each([
    HeterogeneousAgentSessionErrorCode.AuthRequired,
    HeterogeneousAgentSessionErrorCode.CliNotFound,
  ])('routes a GitHub Copilot %s error to the install and sign-in guide', (code) => {
    expect(
      isHeterogeneousAgentStatusGuideError({
        agentType: 'copilot',
        code,
        command: 'copilot',
        message: 'GitHub Copilot is unavailable',
      }),
    ).toBe(true);
  });

  it('leaves other Copilot errors on the generic error card', () => {
    expect(
      isHeterogeneousAgentStatusGuideError({
        agentType: 'copilot',
        code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
        command: 'copilot',
        message: 'The saved GitHub Copilot session could not be found.',
      }),
    ).toBe(false);
  });
});
