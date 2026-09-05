import { describe, expect, it } from 'vitest';

import {
  buildAgentShareOwnerPath,
  buildAgentShareSignInUrl,
  buildAgentShareVisitorPath,
} from './visitorPath';

describe('visitorPath', () => {
  it('builds the visitor page path under /a', () => {
    expect(buildAgentShareVisitorPath('my-bot')).toBe('/a/my-bot');
  });

  it('returns a signed-in visitor to the same share', () => {
    expect(buildAgentShareSignInUrl('my-bot')).toBe('/signin?callbackUrl=%2Fa%2Fmy-bot');
  });

  describe('buildAgentShareOwnerPath', () => {
    it('sends the creator to the share settings on desktop', () => {
      expect(buildAgentShareOwnerPath('agt_1')).toBe('/agent/agt_1/share');
    });

    it('sends the creator to the agent itself on mobile, which has no share settings page', () => {
      expect(buildAgentShareOwnerPath('agt_1', { mobile: true })).toBe('/agent/agt_1');
    });
  });
});
