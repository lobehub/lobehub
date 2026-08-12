import type {
  AcceptanceCheckReviewAction,
  AcceptanceRejectIntent,
  AcceptanceStatus,
  AcceptanceSubjectType,
  ReviewAdjudication,
  ReviewPredictionAction,
  ReviewPredictionStatus,
  ReviewProposalEdit,
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
  acceptanceCheckReviewActions,
  acceptanceRejectIntents,
  acceptanceStatuses,
  acceptanceSubjectTypes,
  reviewAdjudications,
  reviewPredictionActions,
  reviewPredictionStatuses,
  reviewProposalEdits,
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
import { isProgrammaticTestCheck, normalizeVerifySurface } from './verify';

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
    expectTypeOf<(typeof acceptanceSubjectTypes)[number]>().toEqualTypeOf<AcceptanceSubjectType>();
    expectTypeOf<(typeof acceptanceStatuses)[number]>().toEqualTypeOf<AcceptanceStatus>();
    expectTypeOf<
      (typeof acceptanceCheckReviewActions)[number]
    >().toEqualTypeOf<AcceptanceCheckReviewAction>();
    expectTypeOf<
      (typeof acceptanceRejectIntents)[number]
    >().toEqualTypeOf<AcceptanceRejectIntent>();
    expectTypeOf<
      (typeof reviewPredictionActions)[number]
    >().toEqualTypeOf<ReviewPredictionAction>();
    expectTypeOf<
      (typeof reviewPredictionStatuses)[number]
    >().toEqualTypeOf<ReviewPredictionStatus>();
    expectTypeOf<(typeof reviewAdjudications)[number]>().toEqualTypeOf<ReviewAdjudication>();
    expectTypeOf<(typeof reviewProposalEdits)[number]>().toEqualTypeOf<ReviewProposalEdit>();
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

describe('isProgrammaticTestCheck', () => {
  it('catches the repo test suites and static gates that clutter an acceptance page', () => {
    expect(isProgrammaticTestCheck('单元测试全部通过')).toBe(true);
    expect(isProgrammaticTestCheck('Unit tests pass')).toBe(true);
    expect(isProgrammaticTestCheck('新增回归测试覆盖该分支')).toBe(true);
    expect(isProgrammaticTestCheck('Type-check is clean')).toBe(true);
    expect(isProgrammaticTestCheck('No new eslint errors')).toBe(true);
    expect(isProgrammaticTestCheck('Integration test suite is green')).toBe(true);
  });

  it('catches the ordinary phrasings the docs name, not only runner/kind keywords', () => {
    // Regression (codex review): these documented gate labels slipped through,
    // so a gates-only round written in plain words still published.
    expect(isProgrammaticTestCheck('All tests pass')).toBe(true);
    expect(isProgrammaticTestCheck('Tests are green')).toBe(true);
    expect(isProgrammaticTestCheck('Build passes')).toBe(true);
    expect(isProgrammaticTestCheck('CI passes')).toBe(true);
    expect(isProgrammaticTestCheck('CI is green')).toBe(true);
    expect(isProgrammaticTestCheck('Formatting is clean')).toBe(true);
    expect(isProgrammaticTestCheck('质量保障', undefined, 'bun run check --test')).toBe(true);
  });

  it('reads the method too — the give-away is often in the how, not the what', () => {
    expect(
      isProgrammaticTestCheck('Topic list stays ordered', undefined, 'bun run test topicList'),
    ).toBe(true);
    expect(
      isProgrammaticTestCheck('Coverage does not regress', 'Quality', 'vitest --coverage'),
    ).toBe(true);
  });

  it('leaves real acceptance checks alone, including command-asserted ones', () => {
    // `program` verifier ≠ programmatic-test check: the subject here is product
    // behavior, and the command is only how it was observed.
    expect(isProgrammaticTestCheck('lh task list --tree returns nested children')).toBe(false);
    expect(isProgrammaticTestCheck('The client reconnects after a dropped socket')).toBe(false);
    expect(isProgrammaticTestCheck('TTS output plays in the reply bubble')).toBe(false);
    expect(isProgrammaticTestCheck('Rejecting a check re-tasks the next round')).toBe(false);
  });

  it('does not fire on a word that merely contains a gate name', () => {
    expect(isProgrammaticTestCheck('The client list renders 200 rows')).toBe(false);
    expect(isProgrammaticTestCheck('Unit price is formatted as currency')).toBe(false);
    expect(isProgrammaticTestCheck('Latest run wins')).toBe(false);
  });

  it('is false for an empty or absent name', () => {
    expect(isProgrammaticTestCheck()).toBe(false);
    expect(isProgrammaticTestCheck('', undefined, null)).toBe(false);
  });
});
