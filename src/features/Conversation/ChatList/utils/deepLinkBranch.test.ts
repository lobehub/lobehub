import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { findBranchSwitchesToMessage } from './deepLinkBranch';

const msg = (
  id: string,
  parentId: string | null,
  role: UIChatMessage['role'] = 'assistant',
  activeBranchIndex?: number,
) =>
  ({
    content: id,
    id,
    metadata: activeBranchIndex === undefined ? undefined : { activeBranchIndex },
    parentId: parentId ?? undefined,
    role,
  }) as UIChatMessage;

describe('findBranchSwitchesToMessage', () => {
  it('activates the regenerated reply the target lives on', () => {
    // u1 -> a1 (first answer) | a2 (regenerated, active) ; a1 -> u2 -> target
    const messages = [
      msg('u1', null, 'user', 1),
      msg('a1', 'u1'),
      msg('a2', 'u1'),
      msg('u2', 'a1', 'user'),
      msg('a3', 'u2'),
    ];

    expect(findBranchSwitchesToMessage(messages, 'a3')).toEqual([
      { branchIndex: 0, messageId: 'a1' },
    ]);
  });

  it('switches every inactive fork on the path, outermost first, and skips active ones', () => {
    const messages = [
      msg('u1', null, 'user', 1),
      msg('a1', 'u1'),
      msg('a2', 'u1'),
      msg('u2', 'a1', 'user', 0),
      msg('a3', 'u2'),
      msg('a4', 'u2'),
      msg('u3', 'a4', 'user'),
    ];

    expect(findBranchSwitchesToMessage(messages, 'u3')).toEqual([
      { branchIndex: 0, messageId: 'a1' },
      { branchIndex: 1, messageId: 'a4' },
    ]);
  });

  it('does not count tool results as branches', () => {
    const messages = [
      msg('u1', null, 'user'),
      msg('a1', 'u1', 'assistant', 0),
      msg('t1', 'a1', 'tool'),
      msg('a2', 'a1'),
    ];

    expect(findBranchSwitchesToMessage(messages, 'a2')).toEqual([]);
    expect(findBranchSwitchesToMessage(messages, 't1')).toEqual([]);
  });

  it('returns nothing for a linear path or an unknown target', () => {
    const messages = [msg('u1', null, 'user'), msg('a1', 'u1')];

    expect(findBranchSwitchesToMessage(messages, 'a1')).toEqual([]);
    expect(findBranchSwitchesToMessage(messages, 'missing')).toEqual([]);
  });
});
