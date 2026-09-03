import { describe, expect, it } from 'vitest';

import { type MessageActionItem } from '../../../types';
import { resolveSlots } from './resolveSlots';

const item = (key: string): MessageActionItem => ({ key, label: key }) as MessageActionItem;

describe('resolveSlots', () => {
  it('resolves plain keys and skips actions that opted out', () => {
    const out = resolveSlots(['copy', 'edit'], { copy: item('copy'), edit: null });
    expect(out).toEqual([item('copy')]);
  });

  it('drops leading, trailing and consecutive dividers', () => {
    const out = resolveSlots(['divider', 'copy', 'divider', 'divider', 'edit', 'divider'], {
      copy: item('copy'),
      edit: item('edit'),
    });
    expect(out).toEqual([item('copy'), { type: 'divider' }, item('edit')]);
  });

  describe('submenu groups', () => {
    it('nests the surviving children under the group action', () => {
      const out = resolveSlots(
        [{ children: ['copyMessageId', 'saveAsEvalCase'], key: 'advanced' }],
        {
          advanced: item('advanced'),
          copyMessageId: item('copyMessageId'),
          saveAsEvalCase: null,
        },
      );
      expect(out).toEqual([{ ...item('advanced'), children: [item('copyMessageId')] }]);
    });

    it('preserves the declared child order', () => {
      const out = resolveSlots([{ children: ['b', 'a'], key: 'advanced' }], {
        a: item('a'),
        advanced: item('advanced'),
        b: item('b'),
      });
      expect((out[0] as MessageActionItem).children?.map((c) => c.key)).toEqual(['b', 'a']);
    });

    // An "Advanced" entry that opens onto nothing is worse than no entry: both
    // children here are gated off (dev mode / Labs), which is the common case.
    it('drops the group entirely when no child survives', () => {
      const out = resolveSlots([{ children: ['copyMessageId'], key: 'advanced' }], {
        advanced: item('advanced'),
        copyMessageId: null,
      });
      expect(out).toEqual([]);
    });

    it('drops the group when the group action itself opted out', () => {
      const out = resolveSlots([{ children: ['copyMessageId'], key: 'advanced' }], {
        advanced: null,
        copyMessageId: item('copyMessageId'),
      });
      expect(out).toEqual([]);
    });

    // The divider before a dropped group must go with it.
    it('does not leave a dangling divider before a dropped group', () => {
      const out = resolveSlots(['copy', 'divider', { children: ['x'], key: 'advanced' }], {
        advanced: item('advanced'),
        copy: item('copy'),
        x: null,
      });
      expect(out).toEqual([item('copy')]);
    });
  });
});
