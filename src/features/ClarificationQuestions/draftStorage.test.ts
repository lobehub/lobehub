/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  accountDraftKey,
  clearClarificationDraft,
  readClarificationDraft,
  writeClarificationDraft,
} from './draftStorage';

const draft = {
  custom: {},
  escapeActive: false,
  escapeText: '',
  picks: { 'Who reads it?': 'option-2' },
  supplementActive: false,
  supplementText: '',
};

describe('clarification draft storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('restores unsent answers for the same round only', () => {
    writeClarificationDraft('goal:g1:d1,d2', draft);

    expect(readClarificationDraft('goal:g1:d1,d2')).toEqual(draft);
    expect(readClarificationDraft('goal:g1:d3')).toBeUndefined();
  });

  it('forgets the answers once they are sent', () => {
    writeClarificationDraft('goal:g1:d1', draft);
    clearClarificationDraft('goal:g1:d1');

    expect(readClarificationDraft('goal:g1:d1')).toBeUndefined();
  });

  it("never restores one account's draft for another in the same browser", () => {
    writeClarificationDraft(accountDraftKey('user-a', 'goal:g1:d1')!, draft);

    expect(readClarificationDraft(accountDraftKey('user-b', 'goal:g1:d1')!)).toBeUndefined();
    expect(accountDraftKey(undefined, 'goal:g1:d1')).toBeUndefined();
  });

  it('treats an unreadable entry as no draft', () => {
    window.localStorage.setItem('lobechat:clarification:draft:v1:goal:g1:d1', '{not json');

    expect(readClarificationDraft('goal:g1:d1')).toBeUndefined();
  });
});
