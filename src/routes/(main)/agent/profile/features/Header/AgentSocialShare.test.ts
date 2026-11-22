import { describe, expect, it } from 'vitest';

import { getAgentPublicUrl } from './AgentSocialShare';

describe('getAgentPublicUrl', () => {
  it('points a published listing at its Community page', () => {
    expect(getAgentPublicUrl('my-agent', 'published')).toBe('https://lobehub.com/agent/my-agent');
  });

  it.each(['unpublished', 'archived', 'deprecated', null])(
    'has no public link while the listing is %s',
    (status) => {
      expect(getAgentPublicUrl('my-agent', status)).toBeUndefined();
    },
  );

  it('has no public link without a Market identifier', () => {
    expect(getAgentPublicUrl(undefined, 'published')).toBeUndefined();
  });
});
