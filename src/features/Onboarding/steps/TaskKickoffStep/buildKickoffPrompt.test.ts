import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { buildKickoffPrompt } from './buildKickoffPrompt';

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key) as unknown as TFunction<'onboarding'>;

describe('buildKickoffPrompt', () => {
  it('falls back to the default prompt without interests', () => {
    expect(buildKickoffPrompt([], t, 'en-US')).toBe('taskKickoff.prompt.default');
    expect(buildKickoffPrompt(['  '], t, 'en-US')).toBe('taskKickoff.prompt.default');
  });

  it('localizes predefined interests and keeps freeform ones as typed', () => {
    expect(buildKickoffPrompt(['coding', 'Bird watching'], t, 'en-US')).toBe(
      `taskKickoff.prompt.withInterests:${JSON.stringify({
        interests: 'interests.area.coding and Bird watching',
      })}`,
    );
  });
});
