import { describe, expect, it } from 'vitest';

import { getAcceptanceStatusActions } from './statusActions';

describe('getAcceptanceStatusActions', () => {
  it('offers both accepting and closing for a settled delivery', () => {
    expect(getAcceptanceStatusActions('delivered')).toEqual(['accept', 'close']);
  });

  it('offers reopening for a closed acceptance', () => {
    expect(getAcceptanceStatusActions('closed')).toEqual(['reopen']);
  });

  it('keeps close available while verification is still active', () => {
    expect(getAcceptanceStatusActions('verifying')).toEqual(['close']);
  });
});
