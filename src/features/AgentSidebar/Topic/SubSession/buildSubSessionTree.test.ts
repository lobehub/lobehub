import { describe, expect, it } from 'vitest';

import {
  buildSubSessionTree,
  type SubSessionNode,
  summarizeSubSessions,
} from './buildSubSessionTree';

const link = (topicId: string, extra: Record<string, string> = {}) => ({
  at: '2026-11-17T00:00:00.000Z',
  topicId,
  ...extra,
});
const node = (
  id: string,
  opener?: string,
  state: SubSessionNode['state'] = 'idle',
): SubSessionNode => ({
  id,
  openedBy: opener ? link(opener) : undefined,
  state,
});

describe('buildSubSessionTree', () => {
  it('nests sub-sessions one level under their opener', () => {
    const tree = buildSubSessionTree([{ id: 'a' }], [node('b', 'a'), node('c', 'a')]);

    expect(tree.childrenByRoot.a.map((n) => n.id)).toEqual(['b', 'c']);
    expect(tree.nestedIds.size).toBe(0);
  });

  it('attaches deeper sub-sessions to the topmost visible ancestor', () => {
    const tree = buildSubSessionTree(
      [{ id: 'a' }],
      [node('b', 'a'), node('c', 'b'), node('d', 'c')],
    );

    expect(tree.childrenByRoot.a.map((n) => n.id)).toEqual(['b', 'c', 'd']);
    expect(Object.keys(tree.childrenByRoot)).toEqual(['a']);
  });

  it('moves a list row that is a sub-session of another list row under it', () => {
    const tree = buildSubSessionTree(
      [{ id: 'a' }, { id: 'b', openedBy: link('a') }],
      [node('b', 'a')],
    );

    expect(tree.nestedIds).toEqual(new Set(['b']));
    expect(tree.childrenByRoot.a.map((n) => n.id)).toEqual(['b']);
  });

  it('keeps a sub-session whose opener is not in the list at the top level', () => {
    const tree = buildSubSessionTree([{ id: 'b', openedBy: link('gone') }], []);

    expect(tree.nestedIds.size).toBe(0);
    expect(tree.childrenByRoot).toEqual({});
  });

  it('ignores a detached link', () => {
    const tree = buildSubSessionTree(
      [{ id: 'a' }, { id: 'b', openedBy: link('a', { detachedAt: 'later' }) }],
      [],
    );

    expect(tree.nestedIds.size).toBe(0);
  });

  it('turns a cycle into top-level rows instead of hiding both', () => {
    const tree = buildSubSessionTree(
      [
        { id: 'a', openedBy: link('b') },
        { id: 'b', openedBy: link('a') },
      ],
      [node('a', 'b'), node('b', 'a')],
    );

    expect(tree.nestedIds.size).toBe(0);
    expect(tree.childrenByRoot).toEqual({});
  });
});

describe('summarizeSubSessions', () => {
  it('rolls up what needs attention', () => {
    expect(
      summarizeSubSessions([
        node('a', 'x', 'running'),
        node('b', 'x', 'waiting_for_user'),
        node('c', 'x', 'idle'),
        node('d', 'x', 'running'),
      ]),
    ).toEqual({ failed: 0, running: 2, waiting: 1 });
  });
});
