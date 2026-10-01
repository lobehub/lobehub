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
  VerifyEvidenceChapter as VerifyEvidenceChapterType,
  VerifyEvidenceChapterKind,
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
  VerifyEvidenceChapter,
  verifyEvidenceChapterKinds,
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
import {
  formatVideoTimestamp,
  isProgrammaticTestCheck,
  normalizeEvidenceMetadata,
  normalizeVerifySurface,
  readEvidenceChapters,
} from './verify';

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
    expectTypeOf<
      (typeof verifyEvidenceChapterKinds)[number]
    >().toEqualTypeOf<VerifyEvidenceChapterKind>();
    expectTypeOf<VerifyEvidenceChapter>().toEqualTypeOf<VerifyEvidenceChapterType>();
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

describe('readEvidenceChapters', () => {
  it('keeps well-formed markers sorted by time and trims their text', () => {
    expect(
      readEvidenceChapters({
        chapters: [
          { kind: 'check', note: '  no skeleton  ', t: 7.9 },
          { kind: 'step', label: 'Scroll #1', t: 2 },
          { kind: 'flag', note: 'request count 0 → 1', t: 7 },
        ],
      }),
    ).toEqual([
      { kind: 'step', label: 'Scroll #1', t: 2 },
      { kind: 'flag', note: 'request count 0 → 1', t: 7 },
      { kind: 'check', note: 'no skeleton', t: 7.9 },
    ]);
  });

  it('drops markers that cannot be placed or say nothing, instead of failing', () => {
    expect(
      readEvidenceChapters([
        { kind: 'step', t: 1 }, // a step needs a label
        { kind: 'check', label: 'only a label', t: 2 }, // a claim needs a note
        { kind: 'guess', note: 'unknown kind', t: 3 },
        { kind: 'flag', note: 'negative', t: -1 },
        { kind: 'flag', note: 'not a number', t: '4' },
        null,
      ]),
    ).toBeUndefined();
    expect(readEvidenceChapters({ comparison: {} })).toBeUndefined();
    expect(readEvidenceChapters('chapters')).toBeUndefined();
  });

  it('caps a runaway list at 100 markers', () => {
    const chapters = Array.from({ length: 150 }, (_, i) => ({
      kind: 'step',
      label: `#${i}`,
      t: i,
    }));
    expect(readEvidenceChapters(chapters)).toHaveLength(100);
  });
});

describe('normalizeEvidenceMetadata', () => {
  const chapters = [
    { kind: 'step', label: 'Open', t: 0 },
    { kind: 'check', t: 1 },
  ];

  it('keeps only valid chapters on a video and leaves other keys alone', () => {
    expect(normalizeEvidenceMetadata({ chapters, comparison: { id: 'a' } }, 'video')).toEqual({
      chapters: [{ kind: 'step', label: 'Open', t: 0 }],
      comparison: { id: 'a' },
    });
  });

  it('strips chapters from media without a timeline', () => {
    expect(normalizeEvidenceMetadata({ chapters, comparison: { id: 'a' } }, 'screenshot')).toEqual({
      comparison: { id: 'a' },
    });
    expect(normalizeEvidenceMetadata({ chapters }, 'screenshot')).toBeNull();
  });

  it('passes metadata without chapters through untouched', () => {
    const metadata = { comparison: { id: 'a' } };
    expect(normalizeEvidenceMetadata(metadata, 'video')).toBe(metadata);
    expect(normalizeEvidenceMetadata(undefined, 'video')).toBeUndefined();
  });
});

describe('formatVideoTimestamp', () => {
  it('formats to the hundredth', () => {
    expect(formatVideoTimestamp(7.2)).toBe('0:07.20');
    expect(formatVideoTimestamp(66.75)).toBe('1:06.75');
  });

  // Rounding the seconds after taking the minutes produced `0:60.00`.
  it('carries a rounded-up second into the next minute', () => {
    expect(formatVideoTimestamp(59.999)).toBe('1:00.00');
    expect(formatVideoTimestamp(119.996)).toBe('2:00.00');
  });

  it('reads an unusable time as the start', () => {
    expect(formatVideoTimestamp(Number.NaN)).toBe('0:00.00');
    expect(formatVideoTimestamp(-1)).toBe('0:00.00');
  });
});
