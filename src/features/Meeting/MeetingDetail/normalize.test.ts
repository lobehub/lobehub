import { describe, expect, it } from 'vitest';

import { minutesLists, taskCreationCounts, transcriptLists } from './normalize';

describe('minutesLists', () => {
  it('keeps the lists the payload sends', () => {
    const lists = minutesLists({ keywords: ['roadmap'] } as any);
    expect(lists.keywords).toEqual(['roadmap']);
  });

  it('treats omitted lists as empty', () => {
    expect(minutesLists({ summary: 'Short sync' } as any)).toEqual({
      actionItems: [],
      chapters: [],
      decisions: [],
      keywords: [],
    });
  });
});

describe('taskCreationCounts', () => {
  it('counts created and failed items', () => {
    expect(taskCreationCounts({ created: [{}, {}], failed: [{}] } as any)).toEqual({
      created: 2,
      failed: 1,
    });
  });

  it('counts zero for omitted lists', () => {
    expect(taskCreationCounts({} as any)).toEqual({ created: 0, failed: 0 });
    expect(taskCreationCounts(undefined)).toEqual({ created: 0, failed: 0 });
  });
});

describe('transcriptLists', () => {
  it('passes through the lists the payload sends', () => {
    const segments = [{ id: 'seg-1' }];
    expect(transcriptLists({ segments, speakers: [] } as any).segments).toBe(segments);
  });

  it('returns the same empty arrays for omitted lists', () => {
    const first = transcriptLists({});
    expect(first).toEqual({ segments: [], speakers: [] });
    expect(transcriptLists({}).segments).toBe(first.segments);
    expect(transcriptLists({}).speakers).toBe(first.speakers);
  });
});
