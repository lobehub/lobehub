import { describe, expect, it } from 'vitest';

import agent from './agent';

describe('agent share copy', () => {
  it('exposes Agent Share budget copy through the shared locale pipeline', () => {
    expect(agent['share.budget.title']).toBe('Shared Usage');
    expect(agent['share.budget.confirm.content']).toContain('{{amount}}');
    expect(agent['share.budget.confirm.rules.source']).not.toContain('subscription');
  });

  it('describes shared links as live visitor chat gated by the share config', () => {
    // Visitor chat is live (VisitorComposer calls execAgent directly), so the
    // confirmation copy must not claim it is unavailable — access is instead
    // scoped by enabledToolIds / filePermissionConfig / allowReadMemory.
    expect(agent['share.privacyWarning.content']).toContain('chat with this agent');
    expect(agent['share.privacyWarning.content']).toContain('Signed-in users');
    expect(agent['share.privacyWarning.items.tools']).toContain('enable below');
    expect(agent['share.visibility.link']).toContain('Signed-in users');
    expect(agent['share.visibility.linkHint']).toContain('Signed-in users');
    expect(agent['share.visibility.linkHint']).toContain('chat with this agent');

    expect(agent['share.settings.limits.desc']).not.toContain('view-only');
    expect(agent['share.settings.permissions.desc']).not.toContain('view-only');
    expect(agent['share.settings.tools.desc']).not.toContain('view-only');
  });
});
