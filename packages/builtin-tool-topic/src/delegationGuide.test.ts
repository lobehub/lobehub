import { describe, expect, it } from 'vitest';

import { delegationGuide } from './delegationGuide';
import { systemPrompt } from './systemRole';

describe('delegationGuide', () => {
  it('maps each need to one path and says what each inherits', () => {
    expect(delegationGuide).toContain('inside this turn** → `callSubAgent`');
    expect(delegationGuide).toContain('`callAgent`');
    expect(delegationGuide).toContain('follow up on** → `openTopic`');
    // Agents without the lab have no lobe-topic tool: the guide must not imply they do.
    expect(delegationGuide).toContain('only when you have the `lobe-topic` tool');
    expect(delegationGuide).toContain('`createTask` / `runTask`');
    expect(delegationGuide).toMatch(/device and working directory/);
    expect(delegationGuide).toMatch(/`new-worktree` \(a fresh branch and worktree/);
    expect(delegationGuide).toContain('Group conversations and Channels');
  });

  it('is part of the lobe-topic system role', () => {
    expect(systemPrompt).toContain(delegationGuide);
  });
});
