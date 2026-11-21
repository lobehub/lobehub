import { describe, expect, it } from 'vitest';

import { mergeContinuationUserInterventionConfig } from './continuationInterventionConfig';

describe('mergeContinuationUserInterventionConfig', () => {
  it('keeps the parked run snapshot when nothing changed since it parked', () => {
    const inherited = { allowList: ['a/b'], approvalMode: 'manual' as const };

    expect(
      mergeContinuationUserInterventionConfig({
        inherited,
        persisted: { allowList: ['a/b'], approvalMode: 'manual' },
      }),
    ).toBe(inherited);
  });

  it('merges a just-remembered tool into the allow list', () => {
    expect(
      mergeContinuationUserInterventionConfig({
        inherited: { allowList: ['a/b'], approvalMode: 'allow-list' },
        persisted: { allowList: ['a/b', 'c/d'], approvalMode: 'allow-list' },
      }),
    ).toEqual({ allowList: ['a/b', 'c/d'], approvalMode: 'allow-list' });
  });

  it.each(['manual', 'allow-list'] as const)(
    'lifts a %s run to auto-run after the owner switched to auto approve',
    (approvalMode) => {
      expect(
        mergeContinuationUserInterventionConfig({
          inherited: { allowList: [], approvalMode },
          persisted: { allowList: [], approvalMode: 'auto-run' },
        }),
      ).toEqual({ allowList: [], approvalMode: 'auto-run' });
    },
  );

  it('never turns a headless run back into an interactive one', () => {
    expect(
      mergeContinuationUserInterventionConfig({
        inherited: { approvalMode: 'headless' },
        persisted: { approvalMode: 'auto-run' },
      }),
    ).toEqual({ approvalMode: 'headless' });
  });

  it("falls back to the owner's foreground preference when the snapshot is gone", () => {
    expect(mergeContinuationUserInterventionConfig({})).toEqual({
      allowList: [],
      approvalMode: 'manual',
    });
    expect(
      mergeContinuationUserInterventionConfig({ persisted: { approvalMode: 'headless' } }),
    ).toEqual({ allowList: [], approvalMode: 'auto-run' });
  });
});
