import { describe, expect, it } from 'vitest';

import { getProjectAcceptanceActions } from './actions';

describe('getProjectAcceptanceActions', () => {
  it.each([
    ['backlog', ['start']],
    ['active', ['requestCompletion']],
    ['paused', ['requestCompletion']],
    ['reviewing', ['reject', 'accept']],
    ['completed', ['reopen']],
    ['archived', ['reopen']],
  ] as const)('returns valid human workflow actions for %s', (status, expected) => {
    expect(getProjectAcceptanceActions(status)).toEqual(expected);
  });
});
