import { describe, expect, it } from 'vitest';

import type { VerdictEntry } from './api';
import { signoffGroups, signoffProgress, submission } from './signoff';

const item = (
  key: string,
  category: string,
  flags: string[],
  signoff: VerdictEntry['signoff'] = 'missing',
): VerdictEntry => ({ category, file: key.split('|')[0], flags, hash: `h-${key}`, key, signoff });

const items = [
  item('src/A.tsx|A#0', 'needs-signoff', ['CROSS_COMPONENT', 'PLACEMENT_SUBSTITUTED']),
  item('src/A.tsx|A#1', 'needs-signoff', ['CROSS_COMPONENT'], 'valid'),
  item('src/B.tsx|B#0', 'difference', ['INNER_TARGET']),
  item('src/B.tsx|B#1', 'difference', []),
  item('src/U.tsx|U#0', 'unpaired', []),
  item('src/U.tsx|U#1', 'unpaired', []),
  item('src/E.tsx|E#0', 'equal', [], 'not-needed'),
  item('src/X.tsx|X#0', 'blocking', []),
];

describe('signoffGroups', () => {
  it('lists each signable case under every reason it can be signed for, unpaired last and one by one', () => {
    expect(
      signoffGroups(items).map((group) => [
        group.reason,
        group.batch,
        group.items.map((entry) => entry.key),
      ]),
    ).toEqual([
      ['CROSS_COMPONENT', true, ['src/A.tsx|A#0', 'src/A.tsx|A#1']],
      ['PLACEMENT_SUBSTITUTED', true, ['src/A.tsx|A#0']],
      ['TOOL_FALSE_POSITIVE', true, ['src/B.tsx|B#0']],
      ['UNPAIRED', false, ['src/U.tsx|U#0', 'src/U.tsx|U#1']],
    ]);
  });

  it('counts signed cases among the signable ones', () => {
    expect(signoffProgress(items)).toEqual({ signed: 1, total: 5 });
  });
});

describe('submission', () => {
  const groups = signoffGroups(items);
  const cross = groups[0];
  const unpaired = groups.at(-1)!;

  it('sends only the selected keys of the group with its reason and note', () => {
    expect(submission(cross, ['src/A.tsx|A#0', 'src/B.tsx|B#0'], ' checked in the app ')).toEqual({
      body: { keys: ['src/A.tsx|A#0'], note: 'checked in the app', reason: 'CROSS_COMPONENT' },
    });
  });

  it('refuses an empty note, an empty selection and several unpaired cases at once', () => {
    expect(submission(cross, ['src/A.tsx|A#0'], '  ')).toEqual({ error: 'NOTE_REQUIRED' });
    expect(submission(cross, [], 'ok')).toEqual({ error: 'NOTHING_SELECTED' });
    expect(submission(unpaired, ['src/U.tsx|U#0', 'src/U.tsx|U#1'], 'ok')).toEqual({
      error: 'UNPAIRED_ONE_BY_ONE',
    });
  });
});
