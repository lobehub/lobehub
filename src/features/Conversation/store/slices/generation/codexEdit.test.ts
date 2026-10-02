import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getCodexEditAncestors } from './codexEdit';

const message = (
  id: string,
  parentId?: string,
  role: UIChatMessage['role'] = 'user',
): UIChatMessage => ({
  content: id,
  createdAt: 1,
  id,
  parentId,
  role,
  updatedAt: 1,
});

/** @example Only the selected message's persisted ancestry can seed its replacement session. */
describe('Codex edit ancestry', () => {
  /** @example A later sibling and a newer turn are excluded even when interleaved in storage. */
  it('follows parent links and excludes the edited message and other branches', () => {
    const rows = [
      message('u1'),
      message('other', 'u1', 'assistant'),
      message('a1', 'u1', 'assistant'),
      message('u2', 'a1'),
      message('later', 'u2', 'assistant'),
    ];
    /** @example The replacement of u2 sees exactly u1 followed by a1. */
    expect(getCodexEditAncestors(rows, 'u2').map((row) => row.id)).toEqual(['u1', 'a1']);
  });

  /** @example The first prompt starts a clean session with no previous conversation. */
  it('supports editing the first prompt', () => {
    /** @example No old prompt is echoed into the new session context. */
    expect(getCodexEditAncestors([message('u1')], 'u1')).toEqual([]);
  });

  /** @example Pagination and corrupt links cannot silently truncate inherited context. */
  it('rejects incomplete or cyclic ancestry before saving the edit', () => {
    /** @example A missing parent requires loading the full conversation. */
    expect(() => getCodexEditAncestors([message('u2', 'missing')], 'u2')).toThrow('incomplete');
    /** @example A cycle must not hang or replay duplicate messages. */
    expect(() =>
      getCodexEditAncestors([message('u2', 'a1'), message('a1', 'u2', 'assistant')], 'u2'),
    ).toThrow('incomplete');
  });
});
