import type {
  VerifierType,
  VerifyCheckResultStatus,
  VerifyEvidenceCapturedBy,
  VerifyEvidenceType,
  VerifyOnFailStrategy,
  VerifyRunOrigin as VerifyRunOriginType,
  VerifyRunScenario,
  VerifyRunSource,
  VerifyRunStatus,
  VerifySurface,
  VerifyUserDecision,
  VerifyVerdict,
} from '@lobechat/types';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  verifierTypes,
  verifyCheckResultStatuses,
  verifyEvidenceCapturedBy,
  verifyEvidenceTypes,
  verifyOnFailStrategies,
  VerifyRunOrigin,
  verifyRunScenarios,
  verifyRunSources,
  verifyRunStatuses,
  verifySurfaces,
  verifyUserDecisions,
  verifyVerdicts,
} from './verify';
import { normalizeVerifySurface } from './verify';

/**
 * `@lobechat/types` declares these unions independently — it cannot import them
 * from here, because it must stay free of a dependency on `@lobechat/const`
 * (which already type-imports from it). These assertions are what stops the two
 * hand-maintained sides from drifting: adding a member on one side only is a
 * type error, caught by `bun run check --type`, not a silent divergence.
 */
describe('verify vocabulary', () => {
  it('matches the unions declared in @lobechat/types', () => {
    expectTypeOf<(typeof verifierTypes)[number]>().toEqualTypeOf<VerifierType>();
    expectTypeOf<(typeof verifyOnFailStrategies)[number]>().toEqualTypeOf<VerifyOnFailStrategy>();
    expectTypeOf<
      (typeof verifyCheckResultStatuses)[number]
    >().toEqualTypeOf<VerifyCheckResultStatus>();
    expectTypeOf<(typeof verifyVerdicts)[number]>().toEqualTypeOf<VerifyVerdict>();
    expectTypeOf<(typeof verifyUserDecisions)[number]>().toEqualTypeOf<VerifyUserDecision>();
    expectTypeOf<(typeof verifyRunStatuses)[number]>().toEqualTypeOf<VerifyRunStatus>();
    expectTypeOf<(typeof verifyRunSources)[number]>().toEqualTypeOf<VerifyRunSource>();
    expectTypeOf<(typeof verifyRunScenarios)[number]>().toEqualTypeOf<VerifyRunScenario>();
    expectTypeOf<(typeof verifySurfaces)[number]>().toEqualTypeOf<VerifySurface>();
    expectTypeOf<(typeof verifyEvidenceTypes)[number]>().toEqualTypeOf<VerifyEvidenceType>();
    expectTypeOf<
      (typeof verifyEvidenceCapturedBy)[number]
    >().toEqualTypeOf<VerifyEvidenceCapturedBy>();
    expectTypeOf<VerifyRunOrigin>().toEqualTypeOf<VerifyRunOriginType>();
  });
});

describe('normalizeVerifySurface', () => {
  it('accepts a canonical surface, case- and space-insensitively', () => {
    expect(normalizeVerifySurface('cli')).toBe('cli');
    expect(normalizeVerifySurface('  Desktop ')).toBe('desktop');
  });

  it('resolves the unambiguous historical spellings', () => {
    expect(normalizeVerifySurface('electron')).toBe('desktop');
    expect(normalizeVerifySurface('browser')).toBe('web');
    expect(normalizeVerifySurface('ios')).toBe('mobile');
  });

  it('rejects a test kind — those name what was run, not where', () => {
    expect(normalizeVerifySurface('unit')).toBeNull();
    expect(normalizeVerifySurface('backend')).toBeNull();
    expect(normalizeVerifySurface('packaged build')).toBeNull();
  });
});
