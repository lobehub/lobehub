import { describe, expect, it } from 'vitest';

import { getThreadMessageView } from './visibleMessages';

/** @example An edited branch exposes its own rows while retaining hidden model context. */
describe('thread visible messages', () => {
  // ROOT CAUSE:
  // Edit excludes its source row. Looking only for that row returned undefined,
  // which rendered inherited parent rows with mutable child-thread actions.
  /** @example Excluding U2 must not expose original U1/A1 for deletion. */
  it('hides inherited rows when the fork source is excluded', () => {
    const messages = [
      { id: 'u1' },
      { id: 'a1' },
      { id: 'edited-u2', threadId: 'child' },
      { id: 'new-a2', threadId: 'child' },
    ];
    /** @example Only independently owned child rows receive action bars. */
    expect(getThreadMessageView(messages, 'u2', 'child', true).visibleIds).toEqual(
      new Set(['edited-u2', 'new-a2']),
    );
  });
  /** @example An empty child shows no inherited editable history. */
  it('keeps an excluded-source child empty before its rows load', () => {
    /** @example Missing child rows do not make the parent history visible. */
    expect(getThreadMessageView([{ id: 'parent' }], 'source', 'child', true).visibleIds).toEqual(
      new Set(),
    );
  });
  /** @example An ordinary inclusive fork preserves its visible anchor. */
  it('preserves the included source and following messages', () => {
    /** @example Ordinary thread UI retains its original positional behavior. */
    expect(
      getThreadMessageView([{ id: 'before' }, { id: 'source' }, { id: 'child' }], 'source')
        .visibleIds,
    ).toEqual(new Set(['source', 'child']));
  });
  // ROOT CAUSE:
  // Native fork anchors name the final raw step, while assistantGroup is keyed by its first step.
  // Resolving group children keeps inherited rows read-only independently of the display ID.
  /** @example A tool-separated assistant anchor resolves to its displayed group. */
  it('protects an inclusive multi-step assistant fork', () => {
    const view = getThreadMessageView(
      [
        { id: 'parent-user' },
        { id: 'first-step', children: [{ id: 'first-step' }, { id: 'last-step' }] },
        { id: 'child-user', threadId: 'child' },
      ],
      'last-step',
      'child',
    );
    expect(view.visibleIds).toEqual(new Set(['first-step', 'child-user']));
    expect(view.sourceDisplayMessageId).toBe('first-step');
    expect(view.readOnlyIds).toEqual(new Set(['parent-user', 'first-step']));
  });

  /** @example Unresolved anchors never make persisted source rows editable. */
  it('fails closed for an absent inclusive anchor in a saved child', () => {
    const view = getThreadMessageView(
      [{ id: 'parent' }, { id: 'child-user', threadId: 'child' }],
      'missing',
      'child',
    );
    expect(view.visibleIds).toEqual(new Set(['child-user']));
    expect(view.readOnlyIds.has('parent')).toBe(true);
  });
});
