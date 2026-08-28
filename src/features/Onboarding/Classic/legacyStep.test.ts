import { CLASSIC_ONBOARDING_MAX_STEP } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isLegacyClassicStep, remapLegacyClassicStep } from './legacyStep';

describe('remapLegacyClassicStep', () => {
  it('maps the shared-prefix positions onto the first classic step', () => {
    expect(remapLegacyClassicStep(1)).toBe(1);
    expect(remapLegacyClassicStep(2)).toBe(1);
  });

  it('maps the legacy interests position onto the second classic step', () => {
    expect(remapLegacyClassicStep(3)).toBe(2);
  });

  it('lands any later legacy step on ProSettings, never the trailing agent picker', () => {
    for (const raw of [4, 5, 6, 7]) {
      expect(remapLegacyClassicStep(raw)).toBe(CLASSIC_ONBOARDING_MAX_STEP - 1);
    }
  });
});

describe('isLegacyClassicStep', () => {
  it('flags only steps beyond the last classic step', () => {
    expect(isLegacyClassicStep(CLASSIC_ONBOARDING_MAX_STEP)).toBe(false);
    expect(isLegacyClassicStep(CLASSIC_ONBOARDING_MAX_STEP + 1)).toBe(true);
    expect(isLegacyClassicStep(7)).toBe(true);
  });
});
