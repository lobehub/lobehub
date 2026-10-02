import { describe, expect, it } from 'vitest';

import type { RuleGroup } from '@/services/expertise';

import {
  appendException,
  findMove,
  revisionAuthorKey,
  ruleOrigin,
  sectionBody,
  sectionsByOwner,
} from './labels';

describe('appendException', () => {
  it('keeps the exceptions already written and adds the new one below', () => {
    expect(appendException('图表内部的间距不算', '打印样式不算')).toBe(
      '图表内部的间距不算\n打印样式不算',
    );
  });

  it('starts the list when there is nothing yet', () => {
    expect(appendException(undefined, '  图表内部的间距不算 ')).toBe('图表内部的间距不算');
  });

  it('replaces the "no boundary given" placeholder instead of keeping it above', () => {
    expect(appendException('边界未由评审者说明', '图表内部的间距不算')).toBe('图表内部的间距不算');
  });

  it('does not add the same exception twice', () => {
    expect(appendException('图表内部的间距不算\n打印样式不算', '打印样式不算')).toBe(
      '图表内部的间距不算\n打印样式不算',
    );
  });
});

describe('findMove', () => {
  it('describes a drag upward as "now before" its new neighbour', () => {
    expect(findMove(['a', 'b', 'c', 'd'], ['c', 'a', 'b', 'd'])).toEqual({
      beforeId: 'a',
      id: 'c',
    });
  });

  it('describes a drag to the end with no neighbour after it', () => {
    expect(findMove(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual({ beforeId: null, id: 'a' });
  });

  it('reports nothing when the order did not change', () => {
    expect(findMove(['a', 'b'], ['a', 'b'])).toBeNull();
  });
});

describe('revisionAuthorKey', () => {
  it("credits the reader only with their own edits, not a teammate's", () => {
    expect(revisionAuthorKey({ byViewer: true, changedBy: 'user' })).toBe('rules.revisions.byYou');
    expect(revisionAuthorKey({ byViewer: false, changedBy: 'user' })).toBe(
      'rules.revisions.byTeammate',
    );
  });

  it('attributes a generalization to the system', () => {
    expect(revisionAuthorKey({ byViewer: false, changedBy: 'system' })).toBe(
      'rules.revisions.bySystem',
    );
  });
});

describe('ruleOrigin', () => {
  const rule = (
    rejectionHitCount: number,
    conversationHitCount: number,
    authored = false,
    materialHitCount = 0,
  ) => ({
    authored,
    conversationHitCount,
    materialHitCount,
    rejectionHitCount,
  });

  it('says a rule was read from material until practice confirms it', () => {
    expect(ruleOrigin(rule(0, 0, false, 2))).toEqual({
      key: 'fromMaterial',
      params: { count: 2 },
    });
    // Once it is also rejected for, the rejection is what the reviewer cares about.
    expect(ruleOrigin(rule(1, 0, false, 2))).toEqual({ key: 'distilled', params: { hits: 1 } });
  });

  it('does not say the reviewer rejected anything for a rule learned in conversation', () => {
    expect(ruleOrigin(rule(0, 35))).toEqual({ key: 'observed', params: { hits: 35 } });
  });

  it('counts only rejections as "you sent it back"', () => {
    expect(ruleOrigin(rule(4, 0))).toEqual({ key: 'distilled', params: { hits: 4 } });
    expect(ruleOrigin(rule(4, 9))).toEqual({
      key: 'distilledAndObserved',
      params: { conversations: 9, rejections: 4 },
    });
  });

  it('keeps a hand-written rule as the reviewer’s own however it was hit since', () => {
    expect(ruleOrigin(rule(2, 1, true))).toEqual({ key: 'authored' });
  });
});

describe('sectionBody', () => {
  it('reads the "no boundary given" sentence as no boundary', () => {
    const sections = [{ body: '边界未由评审者说明', key: 'limits' as const }];
    expect(sectionBody({ sections }, 'limits')).toBeUndefined();
  });
});

describe('sectionsByOwner', () => {
  const agent = (id: string) => ({
    agent: { avatar: null, backgroundColor: null, id, title: id },
    kind: 'agent' as const,
  });
  const group = (id: string, owner: RuleGroup['owner']) =>
    ({ domain: { id }, owner, rules: [], scopes: [] }) as unknown as RuleGroup;

  it("puts the reviewer's rules first and gathers each agent's groups together", () => {
    const sections = sectionsByOwner([
      group('mine-1', { kind: 'mine' }),
      group('fox-1', agent('fox')),
      group('owl-1', agent('owl')),
      group('fox-2', agent('fox')),
    ]);

    expect(sections.map((s) => s.key)).toEqual(['mine', 'agent:fox', 'agent:owl']);
    expect(sections[1].groups.map((g) => g.domain.id)).toEqual(['fox-1', 'fox-2']);
  });

  it("keeps the reviewer's part even when only agents have learned anything", () => {
    const sections = sectionsByOwner([group('fox-1', agent('fox'))]);

    expect(sections[0]).toMatchObject({ groups: [], key: 'mine' });
  });
});
