import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSkillInstructionsUrl } from './getSkillInstructionsUrl';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('getSkillInstructionsUrl', () => {
  it('should keep the official instructions URL when no Market is configured', () => {
    vi.stubGlobal('__SERVER_CONFIG__', undefined);
    vi.stubEnv('NEXT_PUBLIC_MARKET_BASE_URL', '');

    expect(getSkillInstructionsUrl('meeting-notes')).toBe(
      'https://lobehub.com/skills/meeting-notes/skill.md',
    );
  });

  it.each(['https://market.example.com', 'https://market.example.com/'])(
    'should use the runtime Market configuration: %s',
    (marketBaseUrl) => {
      vi.stubGlobal('__SERVER_CONFIG__', { clientEnv: { marketBaseUrl } });
      vi.stubEnv('NEXT_PUBLIC_MARKET_BASE_URL', 'https://build.example.com');

      expect(getSkillInstructionsUrl('meeting-notes')).toBe(
        'https://market.example.com/s/skills/meeting-notes',
      );
    },
  );

  it('should support a configured frontend Market URL and encode the identifier', () => {
    vi.stubGlobal('__SERVER_CONFIG__', undefined);
    vi.stubEnv('NEXT_PUBLIC_MARKET_BASE_URL', 'https://market.example.com/base/');

    expect(getSkillInstructionsUrl('team/meeting notes')).toBe(
      'https://market.example.com/base/s/skills/team%2Fmeeting%20notes',
    );
  });
});
