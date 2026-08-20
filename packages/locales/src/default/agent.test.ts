import { describe, expect, it } from 'vitest';

import agent from './agent';

describe('agent share copy', () => {
  it('describes shared links as view-only until visitor conversations launch', () => {
    expect(agent['share.privacyWarning.content']).toContain('not available yet');
    expect(agent['share.privacyWarning.items.tools']).toContain('cannot invoke');
    expect(agent['share.visibility.linkHint']).toContain('view this agent');

    expect(agent['share.settings.limits.desc']).toContain('currently view-only');
    expect(agent['share.settings.permissions.desc']).toContain('currently view-only');
    expect(agent['share.settings.tools.desc']).toContain('currently view-only');
  });
});
