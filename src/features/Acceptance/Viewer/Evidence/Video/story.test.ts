import type { VerifyEvidenceChapter } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  activeStoryEntryId,
  buildVideoStory,
  captionEntriesAt,
  fanOutPins,
  spanFromFrame,
  storyEntryCaption,
  type StoryNote,
  toScrubberSegments,
} from './story';

const chapters: VerifyEvidenceChapter[] = [
  { kind: 'check', note: 'Range still reads 30 days after returning.', t: 9.2 },
  { kind: 'step', label: 'Open Balance', t: 5 },
  { kind: 'flag', note: 'The range may reset when the tab remounts.', t: 8.1 },
  { kind: 'step', label: 'Select 30 days', t: 0 },
  { kind: 'step', label: 'Back to Usage', t: 8 },
  { kind: 'check', note: 'Range reads 30 days before the switch.', t: 4 },
];

const note = (key: number, start: number, extra: Partial<StoryNote> = {}): StoryNote => ({
  key,
  start,
  ...extra,
});

const shape = (entries: ReturnType<typeof buildVideoStory>) =>
  entries.map((entry) => {
    switch (entry.type) {
      case 'chapter': {
        return `chapter ${entry.time} ${entry.label}`;
      }
      case 'claim': {
        return `${entry.claim.kind} ${entry.time}${entry.dispute ? ' disputed' : ''}`;
      }
      case 'note': {
        return `note#${entry.index} ${entry.time}`;
      }
    }
  });

describe('buildVideoStory', () => {
  it('interleaves chapters, agent claims and reviewer notes in playing order', () => {
    expect(shape(buildVideoStory(chapters, [note(2, 9.5), note(1, 6.4)]))).toEqual([
      'chapter 0 Select 30 days',
      'check 4',
      'chapter 5 Open Balance',
      'note#1 6.4',
      'chapter 8 Back to Usage',
      'flag 8.1',
      'check 9.2',
      'note#2 9.5',
    ]);
  });

  it('opens a moment with its chapter, then the claim, then the note about it', () => {
    const story = buildVideoStory(
      [
        { kind: 'check', note: 'loaded', t: 5 },
        { kind: 'step', label: 'Open', t: 5 },
      ],
      [note(1, 5)],
    );
    expect(story.map((entry) => entry.type)).toEqual(['chapter', 'claim', 'note']);
  });

  it('folds a dispute into the claim it answers instead of listing it twice', () => {
    const disputes = { kind: 'check' as const, note: chapters[0].note, t: 9.2 };
    const story = buildVideoStory(chapters, [note(7, 9.2, { disputes }), note(8, 6.4)]);

    expect(shape(story)).toEqual([
      'chapter 0 Select 30 days',
      'check 4',
      'chapter 5 Open Balance',
      'note#1 6.4',
      'chapter 8 Back to Usage',
      'flag 8.1',
      'check 9.2 disputed',
    ]);
    const claim = story.find((entry) => entry.type === 'claim' && entry.dispute);
    expect(claim?.type === 'claim' && claim.dispute?.key).toBe(7);
  });

  it('keeps a dispute whose claim is gone as a note of its own', () => {
    const disputes = { kind: 'flag' as const, note: 'removed in a later round', t: 3 };
    expect(shape(buildVideoStory(chapters.slice(3), [note(1, 3, { disputes })]))).toEqual([
      'chapter 0 Select 30 days',
      'note#1 3',
      'check 4',
      'chapter 8 Back to Usage',
    ]);
  });

  it('settles one of two identical-looking claims per dispute', () => {
    const twin: VerifyEvidenceChapter = { kind: 'check', note: 'same', t: 2 };
    const story = buildVideoStory([twin, { ...twin }], [note(1, 2, { disputes: twin })]);
    expect(shape(story)).toEqual(['check 2 disputed', 'check 2']);
  });

  it('numbers notes drawn on one frame in the order they were made', () => {
    const story = buildVideoStory([], [note(11, 3), note(12, 3), note(10, 1)]);
    expect(story.map((entry) => entry.type === 'note' && [entry.note.key, entry.index])).toEqual([
      [10, 1],
      [11, 2],
      [12, 3],
    ]);
  });

  it('gives every entry a distinct id', () => {
    const twin: VerifyEvidenceChapter = { kind: 'check', note: 'same', t: 2 };
    const ids = buildVideoStory(
      [twin, { ...twin }, { kind: 'step', label: 'A', t: 2 }],
      [note(1, 2)],
    ).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('activeStoryEntryId', () => {
  const story = buildVideoStory(chapters, [note(1, 6.4, { end: 7.5 })]);

  it('is nothing before the first claim or note', () => {
    expect(activeStoryEntryId(story, 2)).toBeUndefined();
  });

  it('follows the playhead to the latest claim or note, never a chapter heading', () => {
    expect(activeStoryEntryId(story, 4.5)).toBe(story[1].id);
    expect(activeStoryEntryId(story, 5.5)).toBe(story[1].id);
    expect(activeStoryEntryId(story, 6.4)).toBe('note-1');
    expect(activeStoryEntryId(story, 8.5)).toBe(story[5].id);
  });

  it('lands on an entry when the player seeks to its exact frame', () => {
    expect(activeStoryEntryId(story, 8.1 - 1e-4)).toBe(story[5].id);
  });
});

describe('toScrubberSegments', () => {
  it('splits the recording at each step and ends the last one at the duration', () => {
    expect(toScrubberSegments(chapters, 14)).toEqual([
      { end: 5, label: 'Select 30 days', start: 0 },
      { end: 8, label: 'Open Balance', start: 5 },
      { end: 14, label: 'Back to Usage', start: 8 },
    ]);
  });

  it('leads with an unnamed stretch when the first step starts late', () => {
    expect(toScrubberSegments([{ kind: 'step', label: 'Open', t: 2 }], 10)).toEqual([
      { end: 2, start: 0 },
      { end: 10, label: 'Open', start: 2 },
    ]);
  });

  it('is one unnamed bar without steps, and nothing before the duration is known', () => {
    expect(toScrubberSegments([{ kind: 'check', note: 'x', t: 1 }], 10)).toEqual([
      { end: 10, start: 0 },
    ]);
    expect(toScrubberSegments(chapters, 0)).toEqual([]);
    expect(toScrubberSegments(chapters, Number.NaN)).toEqual([]);
  });

  it('drops steps past the end and steps sharing a start', () => {
    expect(
      toScrubberSegments(
        [
          { kind: 'step', label: 'A', t: 0 },
          { kind: 'step', label: 'B', t: 0 },
          { kind: 'step', label: 'Late', t: 30 },
        ],
        10,
      ),
    ).toEqual([{ end: 10, label: 'A', start: 0 }]);
  });
});

describe('spanFromFrame', () => {
  it('runs from the marked frame to the playhead when the playhead is past it', () => {
    expect(spanFromFrame(6.4, 8, 14)).toEqual({ end: 8, start: 6.4 });
  });

  it('covers one second when the playhead is still on the frame', () => {
    expect(spanFromFrame(6.4, 6.4, 14)).toEqual({ end: 7.4, start: 6.4 });
    expect(spanFromFrame(6.4, 2, 14)).toEqual({ end: 7.4, start: 6.4 });
  });

  it('never runs past the end of the recording', () => {
    expect(spanFromFrame(13.6, 13.6, 14)).toEqual({ end: 14, start: 13.6 });
  });
});
describe('captionEntriesAt', () => {
  const comments: Record<string, string> = { 1: 'The selector already reads 7 days.', 2: '  ' };
  const noteText = (item: StoryNote) => comments[item.key];
  const story = buildVideoStory(chapters, [note(1, 6.4, { end: 11 }), note(2, 12)]);
  const captions = (time: number, entries = story) =>
    captionEntriesAt(entries, time, noteText).map((entry) => storyEntryCaption(entry, noteText));

  it('captions an agent claim when the player seeks to it', () => {
    expect(captions(4)).toEqual(['Range reads 30 days before the switch.']);
    expect(captions(8.1 - 1e-4)).toEqual(['The range may reset when the tab remounts.']);
    expect(captions(9.2)).toEqual(['Range still reads 30 days after returning.']);
  });

  it('captions a chapter step and the reviewer note by their own text', () => {
    expect(captions(0)).toEqual(['Select 30 days']);
    expect(captions(6.4)).toEqual(['The selector already reads 7 days.']);
  });

  it('holds a caption for two seconds, then clears it', () => {
    const claimOnly = buildVideoStory([chapters[5]], []);
    expect(captions(5.9, claimOnly)).toEqual(['Range reads 30 days before the switch.']);
    expect(captions(6, claimOnly)).toEqual([]);
    expect(captions(3.9, claimOnly)).toEqual([]);
  });

  it('lets the later entry take over while an earlier one is still held', () => {
    expect(captions(5.5)).toEqual(['Open Balance']);
    expect(captions(8.05)).toEqual(['Back to Usage']);
  });

  it('keeps a span note captioned until the span ends unless something newer starts', () => {
    const spanOnly = buildVideoStory([], [note(1, 6.4, { end: 11 })]);
    expect(captions(10.9, spanOnly)).toEqual(['The selector already reads 7 days.']);
    expect(captions(11.5, spanOnly)).toEqual([]);
    expect(captions(10.9)).toEqual(['Range still reads 30 days after returning.']);
  });

  it('skips entries with nothing to read', () => {
    expect(captions(12)).toEqual([]);
    expect(captions(1, buildVideoStory([{ kind: 'step', t: 1 }], []))).toEqual([]);
  });

  it('captions every entry sharing the moment, in story order', () => {
    const shared = buildVideoStory(
      [
        { kind: 'check', note: 'loaded', t: 5 },
        { kind: 'flag', note: 'slow', t: 5 },
        { kind: 'step', label: 'Open', t: 5 },
      ],
      [note(1, 5)],
    );
    expect(captions(5, shared)).toEqual([
      'Open',
      'loaded',
      'slow',
      'The selector already reads 7 days.',
    ]);
  });

  it('returns the story entries themselves so a subscriber can compare them', () => {
    expect(captionEntriesAt(story, 4, noteText)[0]).toBe(story[1]);
  });
});

describe('fanOutPins', () => {
  const pin = (id: string, time: number) => ({ id, time });
  const slot = (pins: ReturnType<typeof pin>[], duration: number, id: string) =>
    fanOutPins(pins, duration).get(id);

  it('leaves a pin with no neighbour exactly on its own time', () => {
    expect(slot([pin('a', 2), pin('b', 8)], 10, 'a')).toEqual({
      after: 0,
      before: 0,
      offset: 0,
      percent: 20,
    });
    expect(slot([pin('a', 2), pin('b', 8)], 10, 'b')?.percent).toBe(80);
  });

  it('fans pins sharing a timestamp out around it, in the order given', () => {
    const slots = fanOutPins([pin('a', 5), pin('b', 5), pin('c', 5)], 10);
    expect([...slots.values()].map((item) => item.offset)).toEqual([-14, 0, 14]);
    expect([...slots.values()].map((item) => item.percent)).toEqual([50, 50, 50]);
    expect([...slots.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('gives every pin of a cluster a distinct resting place', () => {
    const slots = fanOutPins([pin('a', 5), pin('b', 5)], 10);
    expect(slots.get('a')?.offset).toBe(-7);
    expect(slots.get('b')?.offset).toBe(7);
  });

  it('treats pins within one percent of the recording as one cluster', () => {
    const slots = fanOutPins([pin('a', 50), pin('b', 50.8), pin('c', 52)], 100);
    expect(slots.get('a')).toMatchObject({ offset: -7, percent: 50.4 });
    expect(slots.get('b')).toMatchObject({ offset: 7, percent: 50.4 });
    expect(slots.get('c')).toEqual({ after: 0, before: 0, offset: 0, percent: 52 });
  });

  it('reserves room at both ends so a cluster clamped to an edge stays fanned out', () => {
    const slots = fanOutPins([pin('a', 0), pin('b', 0), pin('c', 0)], 10);
    expect([...slots.values()].map((item) => [item.before, item.after])).toEqual([
      [0, 28],
      [14, 14],
      [28, 0],
    ]);
  });

  it('clusters by time whatever order the pins arrive in', () => {
    const slots = fanOutPins([pin('late', 9), pin('a', 5), pin('b', 5)], 10);
    expect(slots.get('late')?.offset).toBe(0);
    expect(slots.get('a')?.offset).toBe(-7);
    expect(slots.get('b')?.offset).toBe(7);
  });

  it('places nothing before the duration is known', () => {
    expect(fanOutPins([pin('a', 5)], 0).size).toBe(0);
    expect(fanOutPins([pin('a', 5)], Number.NaN).size).toBe(0);
  });
});
