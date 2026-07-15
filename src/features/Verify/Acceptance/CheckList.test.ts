import { describe, expect, it } from 'vitest';

import { type AcceptanceCheck, groupChecks } from './CheckList';

const check = (id: string, category: string | null, surface: AcceptanceCheck['surface']) =>
  ({ category, id, surface }) as AcceptanceCheck;

describe('groupChecks', () => {
  it('groups checks by business category', () => {
    const groups = groupChecks(
      [
        check('duration', 'Rate-limit recovery', 'desktop'),
        check('reset', 'Rate-limit recovery', 'cli'),
        check('browser', 'Browser actions', 'desktop'),
      ],
      'Other requirements',
    );

    expect(
      groups.map(({ key, label, checks }) => ({ ids: checks.map((item) => item.id), key, label })),
    ).toEqual([
      {
        ids: ['duration', 'reset'],
        key: 'category:Rate-limit recovery',
        label: 'Rate-limit recovery',
      },
      { ids: ['browser'], key: 'category:Browser actions', label: 'Browser actions' },
    ]);
  });

  it('never falls back to technical surfaces', () => {
    const groups = groupChecks(
      [check('desktop', null, 'desktop'), check('cli', null, 'cli')],
      'Other requirements',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('uncategorized');
    expect(groups[0]?.label).toBe('Other requirements');
    expect(groups[0]?.checks.map((item) => item.id)).toEqual(['desktop', 'cli']);
  });
});
