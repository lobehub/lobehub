import { describe, expect, it } from 'vitest';

import { resolveTerminalErrorGuide } from './heteroTerminalError';

const copilot = { agentType: 'copilot', command: 'copilot' };

describe('resolveTerminalErrorGuide', () => {
  it('keeps a payload the adapter already classified', () => {
    const data = { agentType: 'claude-code', code: 'overloaded', message: '529 Overloaded' };

    expect(resolveTerminalErrorGuide(data, { agentType: 'claude-code' })).toBe(data);
  });

  it('classifies a bare Copilot sign-in failure as auth_required', () => {
    const message =
      'ACP request failed (session/new): 401 unauthorized: Personal Access Token does not have "Copilot Requests" permission';

    expect(resolveTerminalErrorGuide({ agentType: 'copilot', message }, copilot)).toMatchObject({
      agentType: 'copilot',
      code: 'auth_required',
      stderr: message,
    });
  });

  it('leaves failures the guide cannot act on unclassified', () => {
    expect(
      resolveTerminalErrorGuide(
        { agentType: 'copilot', message: 'model produced no output' },
        copilot,
      ),
    ).toBeUndefined();
    expect(resolveTerminalErrorGuide(undefined, copilot)).toBeUndefined();
  });
});
