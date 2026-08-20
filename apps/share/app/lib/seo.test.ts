import { describe, expect, it } from 'vitest';

import { shareMetaDescription } from './seo';

describe('shareMetaDescription', () => {
  it('uses the localized agent-share fallback', () => {
    expect(
      shareMetaDescription(
        { chat: { 'sharePage.meta.agentDescription': '分享自 {{appName}} 的智能体。' } },
        'agentDescription',
      ),
    ).toContain('分享自');
  });
});
