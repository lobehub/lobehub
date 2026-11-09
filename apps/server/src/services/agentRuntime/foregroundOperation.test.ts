import { RequestTrigger } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isComposerSupersedableTrigger, isForegroundOperationTrigger } from './foregroundOperation';

describe('foreground operation triggers', () => {
  // Both can hold the main-spine marker without the client tracking them, so a
  // composer send must be able to retire either.
  it.each([RequestTrigger.TaskCallback, RequestTrigger.AgentSignal])(
    'treats %s as a server-started run the composer may retire',
    (trigger) => {
      expect(isForegroundOperationTrigger(trigger)).toBe(false);
      expect(isComposerSupersedableTrigger(trigger)).toBe(true);
    },
  );

  it.each([RequestTrigger.Task, RequestTrigger.Cron])(
    'leaves %s runs to finish when the user sends',
    (trigger) => {
      expect(isForegroundOperationTrigger(trigger)).toBe(false);
      expect(isComposerSupersedableTrigger(trigger)).toBe(false);
    },
  );

  it('lets the composer retire foreground runs, including legacy rows without a trigger', () => {
    expect(isComposerSupersedableTrigger(RequestTrigger.Chat)).toBe(true);
    expect(isComposerSupersedableTrigger(undefined)).toBe(true);
  });
});
