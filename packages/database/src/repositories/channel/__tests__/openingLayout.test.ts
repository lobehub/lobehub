import { describe, expect, it } from 'vitest';

import type { OpeningFacts } from '../openingLayout';
import { chooseOpeningLayout } from '../openingLayout';

const facts = (overrides: Partial<OpeningFacts>): OpeningFacts => ({
  acknowledges: true,
  coAddressed: false,
  inThread: false,
  requestHasArchivedThread: false,
  requestHasOpenThread: false,
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
    [
      'Agents asked together share the Thread under the request, even with one person',
      { coAddressed: true },
      'underRequest',
    ],
    [
      'an Agent asked together that would answer in place joins their open Thread',
      { coAddressed: true, requestHasOpenThread: true, wantsThread: false },
      'underRequest',
    ],
    [
      'an Agent asked together answers in place while nobody has opened a Thread',
      { coAddressed: true, wantsThread: false },
      'inline',
    ],
    [
      'Agents asked together never reopen an archived Thread under the request',
      { coAddressed: true, requestHasArchivedThread: true, requestHasOpenThread: true },
      'underAck',
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
