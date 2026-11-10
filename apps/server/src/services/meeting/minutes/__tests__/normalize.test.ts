import { describe, expect, it, vi } from 'vitest';

import {
  generatedMinutesSchema,
  type MinutesTranscriptLine,
  normalizeMinutes,
  parseDueDate,
} from '../normalize';

const lines: MinutesTranscriptLine[] = [
  { endMs: 4000, segmentId: 'seg_0', speakerLabel: 'S1', startMs: 0 },
  { endMs: 9000, segmentId: 'seg_1', speakerLabel: 'S2', startMs: 4000 },
  { endMs: 15_000, segmentId: 'seg_2', speakerLabel: 'S1', startMs: 9000 },
  { endMs: 21_000, segmentId: 'seg_3', startMs: 15_000 },
];

const options = {
  actionItemId: (index: number) => `act_${index}`,
  resolveAssignee: vi.fn((hint?: string) =>
    hint === 'Alice' ? { id: 'u_alice', name: 'Alice', type: 'user' as const } : undefined,
  ),
};

const parse = (raw: unknown) => generatedMinutesSchema.parse(raw);

describe('generatedMinutesSchema', () => {
  it('rejects output missing a required section or with an empty summary', () => {
    expect(generatedMinutesSchema.safeParse({ summary: 'x' }).success).toBe(false);
    expect(
      generatedMinutesSchema.safeParse({
        actionItems: [],
        chapters: [],
        decisions: [],
        keywords: [],
        summary: '   ',
      }).success,
    ).toBe(false);
    expect(
      generatedMinutesSchema.safeParse({
        actionItems: [{ text: 'x', segmentIndexes: ['1'] }],
        chapters: [],
        decisions: [],
        summary: 'ok',
      }).success,
    ).toBe(false);
  });

  it('defaults optional strings a model left out', () => {
    const parsed = parse({
      actionItems: [{ text: 'Ship it' }],
      chapters: [],
      decisions: [],
      summary: 'ok',
    });
    expect(parsed.actionItems[0]).toEqual({
      assignee: '',
      dueDate: '',
      segmentIndexes: [],
      text: 'Ship it',
    });
    expect(parsed.keywords).toEqual([]);
  });
});

describe('normalizeMinutes', () => {
  it('maps cited line numbers to segment ids and the source timestamp', () => {
    const minutes = normalizeMinutes(
      parse({
        actionItems: [
          {
            assignee: 'Alice',
            dueDate: '2026-10-28',
            segmentIndexes: [2, 1, 2, 9, -1],
            text: 'Ship the beta',
          },
        ],
        chapters: [],
        decisions: [{ segmentIndexes: [3], text: 'Launch next week' }],
        keywords: ['beta', ' beta ', ''],
        summary: 'Summary',
      }),
      lines,
      options,
    );

    expect(minutes.decisions).toEqual([{ segmentIds: ['seg_3'], text: 'Launch next week' }]);
    expect(minutes.actionItems).toEqual([
      {
        assignee: { id: 'u_alice', name: 'Alice', type: 'user' },
        assigneeHint: 'Alice',
        dueDate: '2026-10-28',
        id: 'act_0',
        // Out-of-range citations are dropped, duplicates merged, order restored.
        segmentIds: ['seg_1', 'seg_2'],
        speakerLabel: 'S2',
        startMs: 4000,
        status: 'suggested',
        text: 'Ship the beta',
      },
    ]);
    expect(minutes.keywords).toEqual(['beta']);
  });

  it('keeps an item without owner, deadline or valid citation, and without inventing them', () => {
    const minutes = normalizeMinutes(
      parse({
        actionItems: [
          { assignee: '', dueDate: 'next Friday', segmentIndexes: [42], text: 'Follow up' },
        ],
        chapters: [],
        decisions: [],
        summary: 'Summary',
      }),
      lines,
      options,
    );

    expect(minutes.actionItems[0]).toEqual({
      id: 'act_0',
      segmentIds: [],
      status: 'suggested',
      text: 'Follow up',
    });
  });

  it('orders chapters, clamps their bounds and removes overlaps', () => {
    const minutes = normalizeMinutes(
      parse({
        actionItems: [],
        chapters: [
          { endIndex: 99, startIndex: 2, title: 'Launch' },
          { endIndex: 0, startIndex: 1, title: 'Intro' },
          { endIndex: 1, startIndex: 1, title: 'Swallowed' },
        ],
        decisions: [],
        summary: 'Summary',
      }),
      lines,
      options,
    );

    expect(minutes.chapters).toEqual([
      { endMs: 9000, segmentIds: ['seg_0', 'seg_1'], startMs: 0, title: 'Intro' },
      { endMs: 21_000, segmentIds: ['seg_2', 'seg_3'], startMs: 9000, title: 'Launch' },
    ]);
  });
});

describe('parseDueDate', () => {
  it('accepts only real calendar dates in YYYY-MM-DD', () => {
    expect(parseDueDate('2026-02-28')).toBe('2026-02-28');
    expect(parseDueDate(' 2026-10-30 ')).toBe('2026-10-30');
    expect(parseDueDate('2026-02-30')).toBeUndefined();
    expect(parseDueDate('2026/10/30')).toBeUndefined();
    expect(parseDueDate('')).toBeUndefined();
    expect(parseDueDate(undefined)).toBeUndefined();
  });
});
