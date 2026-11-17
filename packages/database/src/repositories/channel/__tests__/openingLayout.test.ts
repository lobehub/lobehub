import { describe, expect, it } from 'vitest';

import type { OpeningFacts } from '../openingLayout';
import { chooseOpeningLayout } from '../openingLayout';

const facts = (overrides: Partial<OpeningFacts>): OpeningFacts => ({
  acknowledges: true,
  inThread: false,
  requestHasArchivedThread: false,
  sharedTimeline: false,
  wantsThread: true,
  ...overrides,
});

describe('chooseOpeningLayout', () => {
  it.each([
    ['a short reply stays in place', { wantsThread: false }, 'inline'],
    ['a request inside a Thread stays there', { inThread: true, sharedTimeline: true }, 'inline'],
    ['a group opens the Thread under the request', { sharedTimeline: true }, 'underRequest'],
    [
      'a group without an acknowledgement still opens under the request',
      { acknowledges: false, sharedTimeline: true },
      'underRequest',
    ],
    ['one person hangs the Thread under the acknowledgement', {}, 'underAck'],
    [
      'one person without an acknowledgement opens under the request',
      { acknowledges: false },
      'underAck',
    ],
    [
      'a group whose request has an archived Thread hangs it under the acknowledgement',
      { requestHasArchivedThread: true, sharedTimeline: true },
      'underAck',
    ],
    [
      'an archived Thread with nothing to hang a new one under stays in place',
      { acknowledges: false, requestHasArchivedThread: true, sharedTimeline: true },
      'inline',
    ],
  ] as const)('%s', (_, overrides, layout) => {
    expect(chooseOpeningLayout(facts(overrides))).toBe(layout);
  });
});
