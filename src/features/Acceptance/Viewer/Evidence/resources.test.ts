import { describe, expect, it } from 'vitest';

import type { AcceptanceCheck } from '../Checks/types';
import { collectResources, countResources, filterResources, resourceKind } from './resources';

const evidence = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  fileId: `file-${id}`,
  fileUrl: `https://files.test/${id}`,
  id,
  type,
  ...extra,
});

const check = (
  seq: number,
  steps: { evidence: unknown[]; roundIndex: number }[],
  current: unknown[] = steps.at(-1)?.evidence ?? [],
) =>
  ({
    evidence: current,
    id: `check-${seq}`,
    resultRound: steps.at(-1)?.roundIndex,
    seq,
    timeline: steps,
    title: `Check ${seq}`,
  }) as unknown as AcceptanceCheck;

describe('resourceKind', () => {
  it('sorts evidence into the three filters', () => {
    expect(resourceKind(evidence('a', 'screenshot'))).toBe('screenshot');
    expect(resourceKind(evidence('b', 'gif'))).toBe('screenshot');
    expect(resourceKind(evidence('c', 'video'))).toBe('recording');
    expect(resourceKind(evidence('d', 'audio'))).toBe('recording');
    expect(resourceKind(evidence('e', 'terminal'))).toBe('other');
    expect(resourceKind(evidence('f', 'markdown'))).toBe('other');
  });

  it('treats media without a file as a plain document', () => {
    expect(resourceKind({ documentId: 'doc', fileUrl: null, type: 'screenshot' })).toBe('other');
  });
});

describe('collectResources', () => {
  it('gathers every round, newest round first, then by check order', () => {
    const items = collectResources([
      check(2, [
        { evidence: [evidence('r1-c2', 'markdown')], roundIndex: 1 },
        { evidence: [evidence('r2-c2', 'screenshot')], roundIndex: 2 },
      ]),
      check(1, [
        { evidence: [evidence('r1-c1', 'screenshot')], roundIndex: 1 },
        { evidence: [evidence('r2-c1', 'video')], roundIndex: 2 },
      ]),
    ]);

    expect(items.map((item) => [item.evidence.id, item.checkSeq, item.roundIndex])).toEqual([
      ['r2-c1', 1, 2],
      ['r2-c2', 2, 2],
      ['r1-c1', 1, 1],
      ['r1-c2', 2, 1],
    ]);
  });

  it('lists a carried-forward file once, under the round that captured it', () => {
    const items = collectResources([
      check(1, [
        { evidence: [evidence('first', 'screenshot', { fileId: 'same' })], roundIndex: 1 },
        { evidence: [evidence('again', 'screenshot', { fileId: 'same' })], roundIndex: 2 },
      ]),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ roundIndex: 1, rounds: [1, 2] });
    expect(items[0].evidence.id).toBe('first');
  });

  it('skips inline text that has no file or document to open', () => {
    const items = collectResources([
      check(1, [
        {
          evidence: [
            { content: 'inline', fileId: null, fileUrl: null, id: 'inline', type: 'text' },
            { documentId: 'doc-1', fileId: null, fileUrl: null, id: 'doc', type: 'markdown' },
          ],
          roundIndex: 1,
        },
      ]),
    ]);

    expect(items.map((item) => item.evidence.id)).toEqual(['doc']);
  });

  it('keeps current evidence that no timeline step carries', () => {
    const items = collectResources([check(3, [], [evidence('loose', 'screenshot')])]);
    expect(items).toHaveLength(1);
    expect(items[0].roundIndex).toBeNull();
  });
});

describe('filtering and counting', () => {
  const items = collectResources([
    check(1, [
      { evidence: [evidence('s1', 'screenshot'), evidence('t1', 'terminal')], roundIndex: 1 },
      {
        evidence: [
          evidence('s1-again', 'screenshot', { fileId: 'file-s1' }),
          evidence('v2', 'video'),
        ],
        roundIndex: 2,
      },
    ]),
    check(2, [{ evidence: [evidence('s2', 'screenshot')], roundIndex: 2 }]),
  ]);

  it('counts each filter tab', () => {
    expect(countResources(items)).toEqual({ all: 4, other: 1, recording: 1, screenshot: 2 });
  });

  it('filters by kind', () => {
    expect(
      filterResources(items, { kind: 'recording', round: null }).map((i) => i.evidence.id),
    ).toEqual(['v2']);
    expect(filterResources(items, { kind: 'all', round: null })).toHaveLength(4);
  });

  it('filters by any round a file appeared in', () => {
    expect(
      filterResources(items, { kind: 'all', round: 2 }).map((item) => item.evidence.id),
    ).toEqual(['v2', 's2', 's1']);
    expect(
      filterResources(items, { kind: 'screenshot', round: 1 }).map((item) => item.evidence.id),
    ).toEqual(['s1']);
  });
});
